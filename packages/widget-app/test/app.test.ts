import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FrameLayout } from '@plasgos/webchat-protocol';

import type { HostPort } from '../src/app';

function last<T>(list: readonly T[]): T | undefined {
    return list[list.length - 1];
}

/** Socket palsu: menyimpan handler server & pancaran klien; `serverEmit` meniru event dari api-crm. */
const socket = vi.hoisted(() => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const emitted: { name: string; payload: unknown }[] = [];
    const fake = {
        connected: false,
        on: (name: string, handler: (payload: unknown) => void) => {
            handlers.set(name, handler);
            return fake;
        },
        emit: (name: string, payload: unknown) => {
            emitted.push({ name, payload });
            return fake;
        },
        connect: () => fake,
        disconnect: () => fake,
    };
    return {
        fake,
        handlers,
        emitted,
        serverEmit(name: string, payload?: unknown): void {
            if (name === 'connect') {
                fake.connected = true;
            }
            handlers.get(name)?.(payload);
        },
    };
});

vi.mock('socket.io-client', () => ({ io: () => socket.fake }));

const WIDGET_ID = 'wgt_0123456789abcdef01234567';

interface Recorded {
    frames: FrameLayout[];
    events: { name: string; data: unknown }[];
    states: unknown[];
}

function host(): HostPort & Recorded {
    const recorded: Recorded = { frames: [], events: [], states: [] };
    return {
        ...recorded,
        frame: (layout) => { recorded.frames.push(layout); },
        state: (state) => { recorded.states.push(state); },
        event: (name, data) => { recorded.events.push({ name, data }); },
        get frames() { return recorded.frames; },
        get events() { return recorded.events; },
        get states() { return recorded.states; },
    };
}

function json(status: number, data: unknown): Response {
    return new Response(JSON.stringify(status < 400 ? { success: true, data } : data), { status, headers: { 'content-type': 'application/json' } });
}

const sent: { url: string; body: unknown }[] = [];
let appearance: Record<string, unknown> = {};
let identity: Record<string, unknown> | null = null;
/** Jawaban `POST /sessions/identify` berikutnya (antrean; kosong = sukses verified). */
const identifyReplies: Response[] = [];

function fakeServer(): void {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => Promise.resolve(route(url, init))));
}

function route(url: string, init?: RequestInit): Response {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    sent.push({ url, body });
    if (url.endsWith(`/widgets/${WIDGET_ID}/config`)) {
        const config = { primary_color: '#1d4ed8', team_title: 'Tim Toko', greeting: 'Halo!', ...appearance };
        return json(200, { widget_id: WIDGET_ID, appearance: config, ...(identity ? { identity } : {}), captcha: { mode: 'off', provider: null, site_key: null } });
    }
    if (url.endsWith('/sessions/identify')) {
        return identifyReplies.shift() ?? json(200, { access_token: 'akses-terverifikasi', expires_in: 900, refresh_token: 'rt-2', visitor_id: 'vis_1', trust_level: 'verified', conversation: null });
    }
    if (url.endsWith('/sessions')) {
        return json(200, { access_token: 'akses', expires_in: 900, refresh_token: 'rt', visitor_id: 'vis_1', trust_level: 'anonymous', conversation: null });
    }
    if (url.endsWith('/conversation')) {
        return json(200, { conversation: null, messages: [] });
    }
    if (url.endsWith('/messages')) {
        const payload = body as { client_message_id: string };
        return json(202, { message_id: 'wcm_1', client_message_id: payload.client_message_id, status: 'accepted', duplicate: false });
    }
    return json(404, { success: false, error_code: 'not_found', message: 'x' });
}

async function settle(): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function startApp() {
    const { WidgetApp } = await import('../src/app');
    const port = host();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = new WidgetApp({ window, document, container, widgetId: WIDGET_ID, host: port });
    app.init({ options: { widgetId: WIDGET_ID }, page: { url: 'https://toko.com/produk', title: 'Produk', referrer: '' }, hostOrigin: 'https://toko.com' });
    await settle();
    socket.serverEmit('connect');
    await settle();
    return { app, port, container };
}

describe('aplikasi widget (iframe)', () => {
    beforeEach(() => {
        sent.length = 0;
        appearance = {};
        identity = null;
        identifyReplies.length = 0;
        socket.emitted.length = 0;
        socket.handlers.clear();
        socket.fake.connected = false;
        localStorage.clear();
        document.body.replaceChildren();
        document.head.replaceChildren();
        fakeServer();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });


    it('boot: konfigurasi → sesi (page_origin website) → ready; launcher berwarna tenant', async () => {
        const { port } = await startApp();

        expect(sent[1]?.body).toMatchObject({ widget_id: WIDGET_ID, page_origin: 'https://toko.com', page: { url: 'https://toko.com/produk' } });
        expect(port.events.map((event) => event.name)).toContain('ready');
        expect(last(port.frames)).toMatchObject({ state: 'launcher' });
        expect(document.documentElement.style.getPropertyValue('--pw-primary')).toBe('#1d4ed8');
        expect(localStorage.getItem(`plasgos_webchat:${WIDGET_ID}:refresh`)).toBe('rt');
    });


    it('pengaturan dashboard hide_launcher → bingkai tersembunyi saat tertutup; open() tetap membuka jendela', async () => {
        appearance = { hide_launcher: true };
        const { app, port } = await startApp();

        expect(last(port.frames)).toMatchObject({ state: 'hidden' });
        app.command({ name: 'open', args: [] });
        expect(last(port.frames)).toMatchObject({ state: 'open' });
    });


    it('identify sebelum sesi siap → diterapkan setelah boot; sesi verified & refresh token dirotasi', async () => {
        const { WidgetApp } = await import('../src/app');
        const port = host();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const app = new WidgetApp({ window, document, container, widgetId: WIDGET_ID, host: port });
        app.init({ options: { widgetId: WIDGET_ID }, page: { url: 'https://toko.com/', title: 'Toko', referrer: '' }, hostOrigin: 'https://toko.com' });
        app.command({ name: 'identify', args: [{ token: 'jwt-pelanggan' }] });
        await settle();
        await settle();

        const request = sent.find((entry) => entry.url.endsWith('/sessions/identify'));
        expect(request?.body).toEqual({ identity_token: 'jwt-pelanggan' });
        expect(last(port.states)).toMatchObject({ trustLevel: 'verified' });
        expect(localStorage.getItem(`plasgos_webchat:${WIDGET_ID}:refresh`)).toBe('rt-2');
    });


    it('identity_mismatch (akun lain tanpa logout) → sesi baru lalu diverifikasi; token tak sah → event error + alasan', async () => {
        identifyReplies.push(json(409, { success: false, error_code: 'identity_mismatch', message: 'x' }));
        const { app, port } = await startApp();
        app.command({ name: 'identify', args: [{ token: 'jwt-akun-lain' }] });
        await settle();
        await settle();
        await settle();

        expect(sent.filter((entry) => entry.url.endsWith('/sessions/identify'))).toHaveLength(2);
        expect(sent.filter((entry) => entry.url.endsWith('/sessions'))).toHaveLength(2);
        expect(last(port.states)).toMatchObject({ trustLevel: 'verified' });

        identifyReplies.push(json(401, { success: false, error_code: 'identity_invalid', message: 'x', details: { reason: 'expired' } }));
        app.command({ name: 'identify', args: [{ token: 'jwt-kedaluwarsa' }] });
        await settle();
        expect(port.events.find((event) => event.name === 'error')?.data).toEqual({ code: 'identity_invalid', reason: 'expired' });
    });


    it('widget wajib terverifikasi → kotak tulis terkunci + ajakan masuk; setelah identify terbuka', async () => {
        identity = { verification: 'required', otp_email: true };
        const { app, container } = await startApp();
        app.command({ name: 'open', args: [] });

        expect((container.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
        expect(container.querySelector('.pw-notice')?.textContent).toBe('Masuk ke akun Anda di website ini untuk mulai chat.');

        app.command({ name: 'identify', args: [{ token: 'jwt-pelanggan' }] });
        await settle();
        await settle();
        expect((container.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false);
    });


    it('kirim: pesan tampil seketika (mengirim…) lalu diterima server dengan id', async () => {
        const { app, container } = await startApp();
        app.command({ name: 'open', args: [] });
        const input = container.querySelector('textarea') as HTMLTextAreaElement;
        input.value = 'Ukuran M masih ada?';
        (container.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));

        expect(container.querySelector('.pw-msg[data-side="visitor"] .pw-bubble')?.textContent).toBe('Ukuran M masih ada?');
        await settle();

        expect(sent.find((request) => request.url.endsWith('/messages'))?.body).toMatchObject({ text: 'Ukuran M masih ada?', page: { url: 'https://toko.com/produk' } });
        expect(container.querySelector('.pw-msg .pw-meta')?.textContent).toContain('Terkirim');
    });


    it('balasan saat jendela tertutup → belum dibaca + event ke website; tanda sampai dikirim; dibuka → dibaca', async () => {
        const { app, port, container } = await startApp();

        socket.serverEmit('message.created', { conversation_id: 'cv_1', message: { id: 'wco_1', client_message_id: null, direction: 'outbound', sender: { kind: 'agent', name: 'Rina' }, type: 'text', text: '**Masih** kak', status: 'sent', timestamp: '2026-10-14T10:00:00.000Z' } });

        expect(container.querySelector('.pw-badge')?.textContent).toBe('1');
        expect(port.events.find((event) => event.name === 'message')?.data).toMatchObject({ text: '**Masih** kak' });
        expect(port.events.find((event) => event.name === 'unread_changed')?.data).toEqual({ count: 1 });
        expect(socket.emitted.find((event) => event.name === 'delivered')?.payload).toEqual({ up_to: '2026-10-14T10:00:00.000Z' });

        app.command({ name: 'open', args: [] });

        expect(last(port.frames)).toMatchObject({ state: 'open', fullscreen: false });
        expect(socket.emitted.some((event) => event.name === 'read')).toBe(true);
        expect(container.querySelector('.pw-badge')?.hasAttribute('hidden')).toBe(true);
        expect(container.querySelector('.pw-msg[data-side="team"] strong')?.textContent).toBe('Masih');
    });


    it('agen mengetik → indikator; sesi dicabut → widget berhenti dengan pesan & event error', async () => {
        const { app, port, container } = await startApp();
        app.command({ name: 'open', args: [] });

        socket.serverEmit('typing', { conversation_id: 'cv_1', typing: true, expires_at: new Date(Date.now() + 8000).toISOString() });
        expect(container.querySelector('.pw-typing')?.textContent).toBe('Tim sedang mengetik…');

        socket.serverEmit('session.revoked', { reason: 'shutdown' });

        expect(container.querySelector('.pw-notice')?.textContent).toBe('Sesi chat berakhir. Muat ulang halaman untuk mulai lagi.');
        expect((container.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
        expect(last(port.events)).toEqual({ name: 'error', data: { code: 'session_revoked' } });
    });
});
