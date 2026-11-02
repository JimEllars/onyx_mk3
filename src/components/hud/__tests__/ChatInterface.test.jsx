// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../../hooks/useAximAuth', () => ({
    useAximAuth: () => ({
        isAuthenticated: true,
        token: 'passport-jwt',
        loginWithPassport: vi.fn(),
        authError: '',
    }),
}));

import ChatInterface from '../ChatInterface';

function streamResponse(text) {
    const encoder = new TextEncoder();
    const chunks = [encoder.encode(text)];
    let index = 0;
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: async () =>
                    index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
            }),
        },
    };
}

function jsonError(status) {
    return { ok: false, status, body: null, json: async () => ({ error: 'nope' }) };
}

async function submit(text) {
    fireEvent.change(screen.getByPlaceholderText('Summon Onyx Mk3...'), { target: { value: text } });
    await act(async () => {
        fireEvent.click(screen.getByRole('button'));
    });
}

describe('ChatInterface persona context', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => streamResponse('data: [DONE]\n\n')));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends the selected domain_context with the summon', async () => {
        render(<ChatInterface />);

        fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'speedreport-network' } });
        await submit('status of the network?');

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe('/api/v1/onyx/summon');
        expect(JSON.parse(init.body)).toEqual({
            message: 'status of the network?',
            domain_context: 'speedreport-network',
        });
        expect(init.headers.Authorization).toBe('Bearer passport-jwt');
    });

    it('defaults to the AXiM Core persona', async () => {
        render(<ChatInterface />);
        expect(screen.getByLabelText('Persona').value).toBe('axim-core');

        await submit('hello');
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        expect(JSON.parse(fetch.mock.calls[0][1].body).domain_context).toBe('axim-core');
    });

    it('lists every persona in the switcher', () => {
        render(<ChatInterface />);
        const options = Array.from(screen.getByLabelText('Persona').options).map((o) => o.value);
        expect(options).toEqual(['axim-core', 'robotics-lab', 'speedreport-network', 'axim-academy']);
    });

    it('reports an authentication failure without retrying', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonError(401)));
        render(<ChatInterface />);
        await submit('hello');

        await waitFor(() =>
            expect(screen.getByText(/Authentication Failure/i)).toBeTruthy(),
        );
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe('ChatInterface failover backoff', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('waits 1s before the first re-route after a 503, not 2s', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonError(503))
            .mockResolvedValueOnce(jsonError(503))
            .mockResolvedValueOnce(streamResponse('data: [DONE]\n\n'));
        vi.stubGlobal('fetch', fetchMock);
        vi.useFakeTimers({ shouldAdvanceTime: true });

        render(<ChatInterface />);

        await act(async () => {
            fireEvent.change(screen.getByPlaceholderText('Summon Onyx Mk3...'), { target: { value: 'hi' } });
            fireEvent.click(screen.getByRole('button'));
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(screen.getByText(/Re-routing connection\.\.\. \(Attempt 1\)/)).toBeTruthy();

        // The first retry is scheduled at 1000ms + jitter (< 1200ms); nothing
        // fires before that, which is the assertion the old fixed 2000ms failed.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(900);
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(4000);
        });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    });
});
