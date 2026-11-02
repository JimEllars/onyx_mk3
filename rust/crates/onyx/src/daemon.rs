//! Embedded HUD daemon (`onyx daemon`, `onyx --daemon`).
//!
//! The daemon serves the compiled React HUD (`rust/crates/onyx/static`, produced
//! by `npx vite build`) straight out of the binary, together with the small
//! read-only JSON surface that the TUI status bar and the HUD poll.
//!
//! It binds to loopback by default. Every request target is screened for CGI
//! argument injection and directory traversal before it can reach the asset
//! table, mirroring the deny list the edge worker enforces at the perimeter.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderName, HeaderValue, Request, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rust_embed::RustEmbed;
use serde_json::json;

pub(crate) const DEFAULT_DAEMON_HOST: &str = "127.0.0.1";
pub(crate) const DEFAULT_DAEMON_PORT: u16 = 3141;

/// Compiled HUD assets, embedded at build time.
///
/// `vite.config.js` writes its bundle to `rust/crates/onyx/static`, which is
/// tracked in git so the crate always compiles without a JS toolchain.
#[derive(RustEmbed)]
#[folder = "static"]
struct HudAssets;

/// Fragments the edge worker refuses at the perimeter, enforced again here so
/// the daemon is never the weaker link when it is reached directly.
const DENIED_FRAGMENTS: [&str; 10] = [
    "..",
    "auto_prepend_file",
    "auto_append_file",
    "allow_url_include",
    "disable_functions",
    "safe_mode",
    ".php",
    "/wp-admin",
    "?-d",
    "php://input",
];

const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; script-src 'self'; \
     style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; \
     connect-src 'self' https://onyx-edge.axim.us.com; frame-ancestors 'none'; \
     base-uri 'self'; form-action 'self'";

struct DaemonState {
    host: String,
    port: u16,
    started_at: Instant,
    asset_count: usize,
}

/// Runs the daemon on its own multi-threaded runtime and blocks until it stops.
pub(crate) fn run_daemon(host: &str, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;

    runtime.block_on(serve(host, port))
}

/// Parses the tokens that follow `onyx daemon`, e.g.
/// `--port 3141 --host 127.0.0.1`. Unknown flags are rejected rather than
/// silently ignored.
pub(crate) fn parse_daemon_options(args: &[String]) -> Result<(String, u16), String> {
    let mut host = DEFAULT_DAEMON_HOST.to_string();
    let mut port = DEFAULT_DAEMON_PORT;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--port" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --port".to_string())?;
                port = parse_port(value)?;
                index += 2;
            }
            flag if flag.starts_with("--port=") => {
                port = parse_port(&flag["--port=".len()..])?;
                index += 1;
            }
            "--host" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "missing value for --host".to_string())?;
                host = value.clone();
                index += 2;
            }
            flag if flag.starts_with("--host=") => {
                host = flag["--host=".len()..].to_string();
                index += 1;
            }
            other => return Err(format!("unknown daemon option: {other}")),
        }
    }

    if host.trim().is_empty() {
        return Err("daemon host must not be empty".to_string());
    }

    Ok((host, port))
}

fn parse_port(value: &str) -> Result<u16, String> {
    value
        .parse::<u16>()
        .map_err(|_| format!("invalid daemon port: {value}"))
}

async fn serve(host: &str, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(DaemonState {
        host: host.to_string(),
        port,
        started_at: Instant::now(),
        asset_count: HudAssets::iter().count(),
    });

    let app = Router::new()
        .route("/api/v1/health", get(daemon_health))
        .route("/api/telemetry/summary", get(telemetry_summary))
        .route("/metrics", get(metrics))
        .fallback(get(static_asset))
        .layer(middleware::from_fn(screen_request))
        .with_state(Arc::clone(&state));

    let listener = tokio::net::TcpListener::bind((host, port)).await?;
    let address = listener
        .local_addr()
        .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], port)));

    tracing::info!(
        host = %address.ip(),
        port = address.port(),
        assets = state.asset_count,
        "Onyx HUD daemon listening"
    );
    if !address.ip().is_loopback() {
        tracing::warn!(
            host = %address.ip(),
            "Onyx HUD daemon is bound to a non-loopback address; keep it behind the edge worker and an HMAC gate"
        );
    }

    axum::serve(listener, app).await?;
    Ok(())
}

// axum requires handlers to be `async fn` (a sync `fn` does not implement
// `Handler`); these handlers need no `.await`, hence the pedantic allowance.
#[allow(clippy::unused_async)]
async fn daemon_health(State(state): State<Arc<DaemonState>>) -> Response {
    health_body(&state)
}

fn health_body(state: &DaemonState) -> Response {
    json_response(json!({
        "status": "ok",
        "service": "onyx-hud-daemon",
        "version": env!("CARGO_PKG_VERSION"),
        "bind": format!("{}:{}", state.host, state.port),
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "assets": state.asset_count,
    }))
}

/// Local mirror of `GET /api/telemetry/summary`.
///
/// The TUI status bar polls this path on the daemon port; only the edge worker
/// served it before, so the edge and cron badges never lit up when Onyx ran
/// stand-alone. Reading the same process-wide counters keeps the TUI, the HUD
/// and the edge in agreement.
#[allow(clippy::unused_async)]
async fn telemetry_summary() -> Response {
    telemetry_summary_body()
}

fn telemetry_summary_body() -> Response {
    let edge_heartbeat =
        telemetry::metrics::EDGE_HEARTBEAT_INTERCEPTS.load(std::sync::atomic::Ordering::Relaxed);
    let daily_cron = api::router::DAILY_CRON_RUNS.load(std::sync::atomic::Ordering::Relaxed);

    let mut response = json_response(json!({
        "edge_heartbeat_intercepts": edge_heartbeat,
        "daily_cron_runs": daily_cron,
        "cache_hit_rate": null,
        "status": "healthy",
    }));
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("max-age=15"),
    );
    response
}

#[allow(clippy::unused_async)]
async fn metrics() -> Response {
    metrics_body()
}

fn metrics_body() -> Response {
    match telemetry::metrics::encode_metrics() {
        Ok(body) => (
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/plain; version=0.0.4"),
            )],
            body,
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("metrics unavailable: {error}"),
        )
            .into_response(),
    }
}

/// Serves an embedded asset, falling back to `index.html` for client-side
/// routes so a refresh on `/hud/console` still renders the HUD.
#[allow(clippy::unused_async)]
async fn static_asset(uri: Uri) -> Response {
    serve_path(&uri)
}

fn serve_path(uri: &Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let candidate = if path.is_empty() { "index.html" } else { path };

    if let Some(response) = asset_response(candidate) {
        return response;
    }
    if uri.path().starts_with("/api/") {
        return (
            StatusCode::NOT_FOUND,
            json_response(json!({ "error": "not_found", "path": uri.path() })),
        )
            .into_response();
    }
    asset_response("index.html").unwrap_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            "HUD assets are missing from this build; run `npx vite build` and rebuild onyx.",
        )
            .into_response()
    })
}

fn asset_response(path: &str) -> Option<Response> {
    let file = HudAssets::get(path)?;
    let cache_control = if path.starts_with("assets/") {
        // Vite fingerprints these file names, so they are safe to pin forever.
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };

    let mut response = Response::new(Body::from(file.data.into_owned()));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type_for(path)),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    Some(response)
}

fn content_type_for(path: &str) -> &'static str {
    let extension = path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Rejects traversal and CGI argument-injection targets with `403` before the
/// router sees them, and stamps response security headers.
async fn screen_request(request: Request<Body>, next: Next) -> Response {
    let target = {
        let uri = request.uri();
        match uri.path_and_query() {
            Some(value) => value.as_str().to_string(),
            None => uri.path().to_string(),
        }
    };

    if is_blocked_target(&target) {
        tracing::warn!(target = %sanitize_for_log(&target), "daemon rejected suspicious request target");
        let mut response = (
            StatusCode::FORBIDDEN,
            json_response(json!({ "error": "forbidden", "reason": "request target rejected" })),
        )
            .into_response();
        apply_security_headers(&mut response);
        return response;
    }

    let mut response = next.run(request).await;
    apply_security_headers(&mut response);
    response
}

fn apply_security_headers(response: &mut Response) {
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-opener-policy"),
        HeaderValue::from_static("same-origin"),
    );
}

/// True when the raw or percent-decoded target contains a denied fragment.
fn is_blocked_target(target: &str) -> bool {
    let decoded = percent_decode(target);
    let lowered_target = target.to_ascii_lowercase();
    let lowered_decoded = decoded.to_ascii_lowercase();

    DENIED_FRAGMENTS
        .iter()
        .any(|fragment| lowered_decoded.contains(*fragment) || lowered_target.contains(*fragment))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                decoded.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Keeps control characters out of the log line when we echo a hostile target.
fn sanitize_for_log(target: &str) -> String {
    target
        .chars()
        .filter(|character| !character.is_control())
        .take(256)
        .collect()
}

fn json_response(body: serde_json::Value) -> Response {
    axum::Json(body).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blocked(targets: &[&str]) {
        for target in targets {
            assert!(
                is_blocked_target(target),
                "expected {target} to be rejected by the daemon deny list"
            );
        }
    }

    #[test]
    fn rejects_directory_traversal() {
        blocked(&[
            "/../../etc/passwd",
            "/assets/..%2f..%2fetc/passwd",
            "/%2e%2e/%2e%2e/etc/shadow",
            "/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd",
        ]);
    }

    #[test]
    fn rejects_cgi_argument_injection() {
        blocked(&[
            "/index.html?-d+allow_url_include%3don",
            "/?auto_prepend_file=php://input",
            "/?auto_append_file=/tmp/payload",
            "/?disable_functions=exec",
            "/?safe_mode=1",
            "/index.php",
            "/wp-admin/admin-ajax.php",
            "/?include=php://input",
        ]);
    }

    #[test]
    fn allows_hud_and_api_routes() {
        for target in [
            "/",
            "/index.html",
            "/assets/index-abc123.js",
            "/assets/index-abc456.css",
            "/api/v1/health",
            "/api/telemetry/summary",
            "/metrics",
            "/?persona=robotics",
        ] {
            assert!(
                !is_blocked_target(target),
                "expected {target} to reach the daemon router"
            );
        }
    }

    #[test]
    fn percent_decode_handles_valid_and_dangling_escapes() {
        assert_eq!(percent_decode("%2e%2e%2f"), "../");
        assert_eq!(percent_decode("/100%"), "/100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("%41"), "A");
    }

    #[test]
    fn maps_asset_content_types() {
        assert_eq!(content_type_for("index.html"), "text/html; charset=utf-8");
        assert_eq!(
            content_type_for("assets/index-abc123.js"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            content_type_for("assets/index-abc456.css"),
            "text/css; charset=utf-8"
        );
        assert_eq!(content_type_for("assets/logo.svg"), "image/svg+xml");
        assert_eq!(content_type_for("favicon.ico"), "image/x-icon");
        assert_eq!(content_type_for("fonts/inter.woff2"), "font/woff2");
        assert_eq!(
            content_type_for("data/payload.bin"),
            "application/octet-stream"
        );
    }

    #[test]
    fn embeds_the_built_hud() {
        assert!(
            HudAssets::get("index.html").is_some(),
            "index.html must be embedded from rust/crates/onyx/static; run `npx vite build` and commit the bundle"
        );
    }

    #[test]
    fn spa_fallback_serves_index_for_client_routes() {
        let response = serve_path(&Uri::from_static("/hud/console"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/html; charset=utf-8")
        );
    }

    #[test]
    fn unknown_api_route_stays_a_404() {
        let response = serve_path(&Uri::from_static("/api/v1/does-not-exist"));
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn html_entrypoint_is_not_cached() {
        let response = match asset_response("index.html") {
            Some(response) => response,
            None => panic!("index.html must be embedded in the test build"),
        };
        assert_eq!(
            response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-cache")
        );
    }

    #[test]
    fn parses_daemon_options() {
        assert_eq!(
            parse_daemon_options(&[]).expect("defaults"),
            (DEFAULT_DAEMON_HOST.to_string(), DEFAULT_DAEMON_PORT)
        );
        assert_eq!(
            parse_daemon_options(&["--port".into(), "4000".into()]).expect("explicit port"),
            (DEFAULT_DAEMON_HOST.to_string(), 4000)
        );
        assert_eq!(
            parse_daemon_options(&["--host".into(), "0.0.0.0".into(), "--port=4100".into()])
                .expect("host and port"),
            ("0.0.0.0".to_string(), 4100)
        );
    }

    #[test]
    fn rejects_bad_daemon_options() {
        assert!(parse_daemon_options(&["--port".into(), "not-a-port".into()]).is_err());
        assert!(parse_daemon_options(&["--port".into()]).is_err());
        assert!(parse_daemon_options(&["--host".into(), "  ".into()]).is_err());
        assert!(parse_daemon_options(&["--turbo".into()]).is_err());
    }

    #[test]
    fn sanitizes_hostile_targets_for_logs() {
        assert_eq!(sanitize_for_log("/ok\u{7}\u{1b}[31m"), "/ok[31m");
    }
}
