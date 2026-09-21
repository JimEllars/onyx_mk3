export interface EmailAttachment {
  filename: string;
  content?: string; // Base64 string
  url?: string;     // Remote resource URL
  content_type?: string;
  content_id?: string;
}

export interface EmailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  template?: string;
  variables?: Record<string, any>;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  meta?: Record<string, string>;
  idempotencyKey?: string;
}

export interface DispatchResult {
  success: boolean;
  provider: 'emailit' | 'resend';
  messageId: string;
  rawResponse: any;
}

export interface EmailItTelemetry {
  rateLimitRemaining: number;
  dailyRemaining: number;
  dailyResetSeconds: number;
}

export class EmailDispatchManager {
  private emailitApiKey: string;
  private resendApiKey: string;
  private primaryBaseUrl = 'https://api.emailit.com/v2';
  private secondaryBaseUrl = 'https://api.resend.com';

  private isCircuitOpen = false;
  private circuitCooldownUntil = 0;
  private latestTelemetry: EmailItTelemetry | null = null;
  private kvStore?: KVNamespace;

  constructor(emailitApiKey: string, resendApiKey: string, kvStore?: KVNamespace) {
    this.emailitApiKey = emailitApiKey;
    this.resendApiKey = resendApiKey;
    this.kvStore = kvStore;
  }

  private async getCircuitBreakerState(): Promise<{ isOpen: boolean, cooldownUntil: number }> {
    if (this.kvStore) {
      try {
        const stateStr = await this.kvStore.get('circuit_breaker_state');
        if (stateStr) {
          const state = JSON.parse(stateStr);
          this.isCircuitOpen = state.isOpen;
          this.circuitCooldownUntil = state.cooldownUntil;
        }
      } catch (e) {}
    }
    return { isOpen: this.isCircuitOpen, cooldownUntil: this.circuitCooldownUntil };
  }

  private async setCircuitBreakerState(isOpen: boolean, cooldownUntil: number) {
    this.isCircuitOpen = isOpen;
    this.circuitCooldownUntil = cooldownUntil;
    if (this.kvStore) {
      try {
        await this.kvStore.put('circuit_breaker_state', JSON.stringify({ isOpen, cooldownUntil }), { expirationTtl: 60 * 60 });
      } catch (e) {}
    }
  }

  public async getLatestTelemetry(): Promise<EmailItTelemetry | null> {
    if (this.kvStore && !this.latestTelemetry) {
      try {
        const telStr = await this.kvStore.get('email_telemetry');
        if (telStr) {
          this.latestTelemetry = JSON.parse(telStr);
        }
      } catch (e) {}
    }
    return this.latestTelemetry;
  }

  private async saveTelemetry() {
    if (this.kvStore && this.latestTelemetry) {
      try {
        await this.kvStore.put('email_telemetry', JSON.stringify(this.latestTelemetry));
      } catch (e) {}
    }
  }

  public async getStatus(): Promise<{ circuitOpen: boolean, telemetry: EmailItTelemetry | null }> {
    const { isOpen, cooldownUntil } = await this.getCircuitBreakerState();
    const isActuallyOpen = isOpen && Date.now() <= cooldownUntil;
    const telemetry = await this.getLatestTelemetry();
    return {
      circuitOpen: isActuallyOpen,
      telemetry
    };
  }

  /**
   * Main send call: Routes to primary or secondary provider based on system health
   */
  public async send(options: EmailOptions): Promise<DispatchResult> {
    try {
      const now = Date.now();
      const { isOpen, cooldownUntil } = await this.getCircuitBreakerState();

      if (isOpen) {
        if (now > cooldownUntil) {
          await this.setCircuitBreakerState(false, 0);
        } else {
          return await this.sendViaResend(options, 'Circuit breaker active for EmailIt');
        }
      }

      const telemetry = await this.getLatestTelemetry();
      if (telemetry && telemetry.dailyRemaining <= 0) {
        return await this.sendViaResend(options, 'EmailIt daily sending quota exhausted');
      }

      try {
        return await this.sendViaEmailIt(options);
      } catch (error: any) {
        // Trip circuit breaker for 5 minutes on server errors or failures
        await this.tripCircuitBreaker(5 * 60 * 1000);
        return await this.sendViaResend(options, error.message);
      }
    } catch (e: any) {
       throw new Error(JSON.stringify({ error: e.message, code: e.message.includes('timeout') ? "504" : "502", retryable: true }));
    }
  }

  /**
   * Dispatches outbound email using primary provider (EmailIt API v2)
   */
  private async sendViaEmailIt(options: EmailOptions): Promise<DispatchResult> {
    const endpoint = `${this.primaryBaseUrl}/emails`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.emailitApiKey}`,
      'Content-Type': 'application/json'
    };

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const payload = {
      from: options.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      reply_to: options.reply_to,
      cc: options.cc,
      bcc: options.bcc,
      template: options.template,
      variables: options.variables,
      attachments: options.attachments,
      headers: options.headers,
      meta: options.meta
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal as any
      });

      this.extractTelemetryHeaders(response);
      await this.saveTelemetry();

      if (response.status === 429) {
        throw new Error('EmailIt Rate Limit Exceeded (HTTP 429)');
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`EmailIt API Error [HTTP ${response.status}]: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      return {
        success: true,
        provider: 'emailit',
        messageId: (data as any).id,
        rawResponse: data
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Dispatches outbound email using fallback provider (Resend API v1)
   */
  private async sendViaResend(options: EmailOptions, reason: string): Promise<DispatchResult> {
    const endpoint = `${this.secondaryBaseUrl}/emails`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.resendApiKey}`,
      'Content-Type': 'application/json'
    };

    if (options.idempotencyKey) {
      headers['X-Idempotency-Key'] = options.idempotencyKey;
    }

    const processedAttachments = await this.resolveAttachmentsForResend(options.attachments);

    const payload: Record<string, any> = {
      from: options.from,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      cc: options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : undefined,
      bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : undefined,
      reply_to: options.reply_to ? (Array.isArray(options.reply_to) ? options.reply_to : [options.reply_to]) : undefined,
      headers: options.headers,
      attachments: processedAttachments
    };

    if (options.meta) {
      payload.tags = Object.entries(options.meta).map(([name, value]) => ({ name, value }));
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(`Critical Secondary Provider Failure (Resend) [HTTP ${response.status}]: ${JSON.stringify(errorBody)}`);
    }

    const data: any = await response.json();
    return {
      success: true,
      provider: 'resend',
      messageId: data.id,
      rawResponse: data
    };
  }

  /**
   * Extracts rate limit and telemetry headers from EmailIt API responses
   */
  private extractTelemetryHeaders(response: Response): void {
    const remaining = response.headers.get('ratelimit-remaining');
    const dailyRemaining = response.headers.get('ratelimit-daily-remaining');
    const dailyReset = response.headers.get('ratelimit-daily-reset');

    if (dailyRemaining !== null) {
      this.latestTelemetry = {
        rateLimitRemaining: remaining ? parseInt(remaining, 10) : 0,
        dailyRemaining: parseInt(dailyRemaining, 10),
        dailyResetSeconds: dailyReset ? parseInt(dailyReset, 10) : 0
      };
    }
  }

  /**
   * Converts URL-based attachments into Base64 strings for Resend compatibility
   */
  private async resolveAttachmentsForResend(attachments?: EmailAttachment[]): Promise<any[] | undefined> {
    if (!attachments || attachments.length === 0) return undefined;

    const resolved = [];
    for (const att of attachments) {
      if (att.content) {
        resolved.push({ filename: att.filename, content: att.content });
      } else if (att.url) {
        const res = await fetch(att.url);
        const buffer = await res.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        resolved.push({ filename: att.filename, content: base64 });
      }
    }
    return resolved;
  }

  private async tripCircuitBreaker(durationMs: number): Promise<void> {
    await this.setCircuitBreakerState(true, Date.now() + durationMs);
  }
}
