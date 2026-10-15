import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMessage } from '@plasgos/webchat-protocol';
import type { FrameLayout } from '@plasgos/webchat-protocol';

import { READY_TIMEOUT_MS, WebchatController } from '../src/controller';
import { ROOT_ID } from '../src/frame';

const WIDGET_ID = 'wgt_0123456789abcdef01234567';
const OTHER_ID = 'wgt_76543210fedcba9876543210';
const WIDGET_ORIGIN = 'https://widget.example.test';

const created: WebchatController[] = [];

function controller(): WebchatController {
    const instance = new WebchatController({ window, document, widgetOrigin: WIDGET_ORIGIN });
    created.push(instance);
    return instance;
}

function iframes(): HTMLIFrameElement[] {
    return Array.from(document.querySelectorAll(`#${ROOT_ID} iframe`));
}

/** Pesan dari iframe widget (origin & source dipalsukan seperti dikirim aplikasi widget). */
function fromWidget(
    data: unknown,
    { origin = WIDGET_ORIGIN, source = iframes()[0]?.contentWindow ?? null } = {},
): void {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

const LAYOUT: FrameLayout = { state: 'launcher', width: 72, height: 72, fullscreen: false, position: 'right', offsetX: 20, offsetY: 20, zIndex: null };

describe('controller loader', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.replaceChildren();
    });

    afterEach(() => {
        // Controller tiap test dimatikan — pengamat MutationObserver-nya akan memasang ulang root ke test berikutnya.
        for (const instance of created.splice(0)) {
            instance.handle('shutdown', []);
        }
        vi.advanceTimersByTime(1000);
        vi.useRealTimers();
        document.body.replaceChildren();
        document.getElementById(ROOT_ID)?.remove();
    });


    it('boot dua kali dengan widget sama (StrictMode/HMR) = satu iframe; widget lain = ganti', () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);

        expect(iframes()).toHaveLength(1);
        expect(iframes()[0]?.src).toBe(`${WIDGET_ORIGIN}/w/${WIDGET_ID}`);
        expect(iframes()[0]?.title).toBe('Jendela chat');

        webchat.handle('boot', [{ widgetId: OTHER_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);

        expect(iframes()).toHaveLength(1);
        expect(iframes()[0]?.src).toBe(`${WIDGET_ORIGIN}/w/${OTHER_ID}`);
    });


    it('mode interaction: iframe baru dibuat saat pengunjung berinteraksi atau open() dipanggil', () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'interaction' }]);
        vi.advanceTimersByTime(5000);
        expect(iframes()).toHaveLength(0);

        webchat.handle('open', []);

        expect(iframes()).toHaveLength(1);
    });


    it('handshake: widget.ready dari origin & iframe yang benar → host.init lalu perintah yang tertunda', () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager', locale: 'en' }]);
        vi.advanceTimersByTime(10);
        const frameWindow = iframes()[0]?.contentWindow;
        expect(frameWindow).toBeTruthy();
        const posted = vi.spyOn(frameWindow as Window, 'postMessage').mockImplementation(() => undefined);
        webchat.handle('open', []);
        expect(posted).not.toHaveBeenCalled();

        fromWidget(createMessage('widget.ready', {}), { origin: 'https://evil.example' });
        fromWidget(createMessage('widget.ready', {}), { source: window });
        expect(posted).not.toHaveBeenCalled();

        fromWidget(createMessage('widget.ready', {}));

        expect(posted.mock.calls.map(([message, origin]) => [(message as { type: string }).type, origin])).toEqual([
            ['host.init', WIDGET_ORIGIN],
            ['host.viewport', WIDGET_ORIGIN],
            ['host.command', WIDGET_ORIGIN],
        ]);
        expect(posted.mock.calls[0]?.[0]).toMatchObject({ payload: { options: { widgetId: WIDGET_ID, locale: 'en' } } });
    });


    it('sinyal pesan proaktif (W8b): gulir kelipatan 10 % sekali per tingkat, niat keluar lewat tepi atas', () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);
        const posted = vi.spyOn(iframes()[0]?.contentWindow as Window, 'postMessage').mockImplementation(() => undefined);
        fromWidget(createMessage('widget.ready', {}));
        Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
        const scrollTo = (y: number): void => {
            Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
            window.dispatchEvent(new Event('scroll'));
        };

        scrollTo(550);
        scrollTo(560);
        scrollTo(1000);
        scrollTo(200);
        document.dispatchEvent(new MouseEvent('mouseout', { clientY: 300 }));
        document.dispatchEvent(new MouseEvent('mouseout', { clientY: 0 }));

        type Posted = { type: string; payload: Record<string, unknown> };
        const activity = posted.mock.calls.map(([message]) => message as Posted).filter((message) => message.type === 'host.activity');
        expect(activity.map((message) => message.payload)).toEqual([{ scroll: 50 }, { scroll: 100 }, { exit: true }]);
    });


    it('boot dengan identityToken (halaman server-rendered) = boot + identify; token TIDAK ikut opsi host.init', () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager', identityToken: 'jwt-pelanggan' }]);
        vi.advanceTimersByTime(10);
        const posted = vi.spyOn(iframes()[0]?.contentWindow as Window, 'postMessage').mockImplementation(() => undefined);

        fromWidget(createMessage('widget.ready', {}));

        type Posted = { type: string; payload: Record<string, unknown> };
        const messages = posted.mock.calls.map(([message]) => message as Posted);
        expect(JSON.stringify(messages.find((message) => message.type === 'host.init'))).not.toContain('jwt-pelanggan');
        const command = messages.find((message) => message.type === 'host.command');
        expect(command?.payload).toEqual({ name: 'identify', args: [{ token: 'jwt-pelanggan' }] });
    });


    it('boot dengan identityToken: null eksplisit (setelah logout) = identify { token: null }; tak diisi = tanpa identify', () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager', identityToken: null }]);
        vi.advanceTimersByTime(10);
        const posted = vi.spyOn(iframes()[0]?.contentWindow as Window, 'postMessage').mockImplementation(() => undefined);
        fromWidget(createMessage('widget.ready', {}));

        type Posted = { type: string; payload: Record<string, unknown> };
        const commands = posted.mock.calls.map(([message]) => message as Posted).filter((message) => message.type === 'host.command');
        expect(commands.map((message) => message.payload)).toEqual([{ name: 'identify', args: [{ token: null }] }]);

        posted.mockClear();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager', identityToken: 42 }]);
        expect(posted.mock.calls.map(([message]) => message as Posted).filter((message) => message.type === 'host.command')).toEqual([]);
    });


    it('tanpa widget.ready dalam 10 detik → widget dilepas, peringatan & event error', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const webchat = controller();
        const onError = vi.fn();
        webchat.handle('on', ['error', onError]);
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);
        expect(iframes()).toHaveLength(1);

        vi.advanceTimersByTime(READY_TIMEOUT_MS);

        expect(document.getElementById(ROOT_ID)).toBeNull();
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'frame_timeout' }));
        expect(warn.mock.calls[0]?.[0]).toMatch(/^\[Plasgos Webchat\] .*domain website/);
        warn.mockRestore();
    });


    it('tata letak dari widget diterapkan lewat CSSOM; opsi boot tenant menimpa posisi', () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager', position: 'left', zIndex: 77 }]);
        vi.advanceTimersByTime(10);
        fromWidget(createMessage('widget.ready', {}));

        fromWidget(createMessage('widget.frame', LAYOUT));
        const root = document.getElementById(ROOT_ID) as HTMLDivElement;

        expect(root.style.position).toBe('fixed');
        expect(root.style.display).toBe('block');
        expect(root.style.left).toBe('20px');
        expect(root.style.right).toBe('auto');
        expect(root.style.width).toBe('72px');
        expect(root.style.zIndex).toBe('77');
        expect(document.querySelector('style')).toBeNull();
    });


    it('layar penuh mengunci scroll halaman lalu mengembalikan nilai semula', () => {
        document.body.style.overflow = 'auto';
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);
        fromWidget(createMessage('widget.ready', {}));

        fromWidget(createMessage('widget.frame', { ...LAYOUT, state: 'open', fullscreen: true }));
        expect(document.body.style.overflow).toBe('hidden');

        fromWidget(createMessage('widget.frame', LAYOUT));
        expect(document.body.style.overflow).toBe('auto');
    });


    it('event widget sampai ke handler tenant; handler yang melempar tak merusak halaman', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const webchat = controller();
        const onMessage = vi.fn();
        webchat.handle('on', ['message', () => {
            throw new Error('bug di website tenant');
        }]);
        webchat.handle('on', ['message', onMessage]);
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);

        fromWidget(createMessage('widget.event', { name: 'message', data: { text: 'Halo' } }));

        expect(onMessage).toHaveBeenCalledWith({ text: 'Halo' });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });


    it('getState mencerminkan widget.state; perintah tak dikenal & opsi salah hanya peringatan', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);
        fromWidget(createMessage('widget.state', { booted: true, open: false, unread: 2, trustLevel: 'anonymous' }));

        expect(webchat.handle('getState', [])).toEqual({ booted: true, open: false, unread: 2, trustLevel: 'anonymous' });
        expect(webchat.handle('hapusSemua', [])).toBeUndefined();
        webchat.handle('boot', [{ widgetId: 'salah' }]);
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });


    it('shutdown memberi tahu iframe lalu melepas widget; boot berikutnya membuat iframe baru', () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);
        const frameWindow = iframes()[0]?.contentWindow as Window;
        const posted = vi.spyOn(frameWindow, 'postMessage').mockImplementation(() => undefined);
        fromWidget(createMessage('widget.ready', {}));

        webchat.handle('shutdown', []);
        vi.advanceTimersByTime(600);

        expect(posted.mock.calls[posted.mock.calls.length - 1]?.[0]).toMatchObject({ type: 'host.command', payload: { name: 'shutdown' } });
        expect(iframes()).toHaveLength(0);

        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);
        expect(iframes()).toHaveLength(1);
    });


    it('root di luar <body>: body diganti utuh (View Transitions/Turbo) → root & iframe yang sama tetap terpasang', async () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);
        const root = document.getElementById(ROOT_ID);

        document.body.replaceWith(document.createElement('body'));
        await Promise.resolve();

        expect(root?.parentElement).toBe(document.documentElement);
        expect(document.getElementById(ROOT_ID)).toBe(root);
        expect(iframes()).toHaveLength(1);
    });


    it('root yang tetap dicabut skrip lain dipasang ulang', async () => {
        const webchat = controller();
        webchat.handle('boot', [{ widgetId: WIDGET_ID, load: 'eager' }]);
        vi.advanceTimersByTime(10);

        document.getElementById(ROOT_ID)?.remove();
        await Promise.resolve();

        expect(document.getElementById(ROOT_ID)?.parentElement).toBe(document.documentElement);
    });
});
