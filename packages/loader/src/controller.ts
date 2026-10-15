import { createMessage, isFromPeer, isHostCommand, parseWidgetMessage, WIDGET_EVENTS } from '@plasgos/webchat-protocol';
import type {
    FrameLayout,
    HostCommand,
    HostMessageType,
    PageInfo,
    ProtocolMessage,
    WidgetEventName,
    WidgetMessages,
} from '@plasgos/webchat-protocol';

import { FrameHost } from './frame';
import { warn } from './log';
import { watchNavigation } from './navigation';
import { identityTokenOf, parseBootOptions } from './options';
import type { ParsedBoot } from './options';

/** Tanpa `widget.ready` selama ini (mis. ditolak `frame-ancestors`: domain belum didaftarkan) → widget dicabut. */
export const READY_TIMEOUT_MS = 10_000;

/** Iframe diberi waktu mencabut sesi & storage sebelum dibongkar saat `shutdown`. */
const SHUTDOWN_GRACE_MS = 500;

const MAX_OUTBOX = 50;

/**
 * Ukuran jendela halaman dilaporkan ke iframe — ia yang memutuskan layar penuh di mobile, padahal ukurannya sendiri
 * hanya selebar launcher. Dirapatkan sekali per jeda ini.
 */
const VIEWPORT_DEBOUNCE_MS = 150;

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

export type EventHandler = (data: unknown) => void;

interface IdleScheduler {
    readonly requestIdleCallback?: Window['requestIdleCallback'];
    readonly cancelIdleCallback?: Window['cancelIdleCallback'];
}

export interface WebchatState {
    readonly booted: boolean;
    readonly open: boolean;
    readonly unread: number;
    readonly trustLevel: string | null;
}

export interface ControllerEnvironment {
    readonly window: Window;
    readonly document: Document;
    /** Origin aplikasi widget (`https://widget.<domain>`); iframe dimuat dari `${widgetOrigin}/w/${widgetId}`. */
    readonly widgetOrigin: string;
}

const INITIAL_STATE: WebchatState = { booted: false, open: false, unread: 0, trustLevel: null };

/**
 * Perintah publik `Plasgos(name, ...args)` → widget di dalam iframe. Loader tak memanggil API apa pun; jaringan &
 * storage seluruhnya di iframe. Semua kesalahan dicatat (`[Plasgos Webchat]`) + event `error`, tak pernah dilempar.
 */
export class WebchatController {
    private boot: ParsedBoot | null = null;

    private frame: FrameHost | null = null;

    private ready = false;

    private state: WebchatState = INITIAL_STATE;

    private outbox: ProtocolMessage<HostMessageType>[] = [];

    private readonly listeners = new Map<WidgetEventName, Set<EventHandler>>();

    private readyTimer: ReturnType<typeof setTimeout> | null = null;

    private cancelScheduledMount: (() => void) | null = null;

    private stopNavigation: (() => void) | null = null;

    /** Kedalaman gulir tertinggi (kelipatan 10 %) yang sudah dilaporkan untuk halaman ini — pemicu proaktif (W8b). */
    private scrolled = 0;

    private readonly onScroll = (): void => {
        const { window: win, document: doc } = this.env;
        const max = doc.documentElement.scrollHeight - win.innerHeight;
        const bucket = max > 0 ? Math.min(100, Math.floor(win.scrollY * 10 / max) * 10) : 100;
        if (bucket > this.scrolled && this.ready) {
            this.scrolled = bucket;
            this.post(createMessage('host.activity', { scroll: bucket }));
        }
    };

    /** Niat keluar (desktop): kursor meninggalkan halaman lewat tepi atas. */
    private readonly onMouseOut = (event: MouseEvent): void => {
        if (!event.relatedTarget && event.clientY <= 0 && this.ready) {
            this.post(createMessage('host.activity', { exit: true }));
        }
    };

    private focusBeforeOpen: HTMLElement | null = null;

    private viewportTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly onMessage = (event: MessageEvent): void => {
        this.receive(event);
    };

    private readonly onResize = (): void => {
        if (this.viewportTimer !== null) {
            clearTimeout(this.viewportTimer);
        }
        this.viewportTimer = setTimeout(() => {
            this.viewportTimer = null;
            this.postViewport();
        }, VIEWPORT_DEBOUNCE_MS);
    };


    public constructor(private readonly env: ControllerEnvironment) {}


    public handle(name: unknown, args: readonly unknown[]): unknown {
        try {
            return this.dispatch(name, args);
        } catch (error) {
            this.fail('internal_error', 'galat internal widget', error);
            return undefined;
        }
    }


    private dispatch(name: unknown, args: readonly unknown[]): unknown {
        switch (name) {
            case 'boot':
                this.start(args[0]);
                return undefined;
            case 'shutdown':
                this.shutdown();
                return undefined;
            case 'on':
                this.on(args[0], args[1]);
                return undefined;
            case 'off':
                this.off(args[0], args[1]);
                return undefined;
            case 'getState':
                return { ...this.state };
            default:
                if (isHostCommand(name)) {
                    this.command(name, args);
                    return undefined;
                }
                warn(`perintah "${String(name)}" tidak dikenal`);
                return undefined;
        }
    }


    private start(input: unknown): void {
        const parsed = parseBootOptions(input);
        if (!parsed.ok) {
            this.fail('invalid_options', parsed.reason);
            return;
        }

        if (this.boot?.widget.widgetId !== parsed.value.widget.widgetId) {
            if (this.boot) {
                this.teardown();
            }
            this.boot = parsed.value;
            this.scheduleMount();
        }

        const identityToken = identityTokenOf(input);
        if (identityToken) {
            this.command('identify', [{ token: identityToken }]);
        }
    }


    private scheduleMount(): void {
        const mode = this.boot?.loader.load ?? 'idle';
        if (mode === 'interaction') {
            this.cancelScheduledMount = this.onFirstInteraction(() => {
                this.mount();
            });
            return;
        }

        this.cancelScheduledMount = this.whenDomReady(() => {
            if (mode === 'eager') {
                this.mount();
                return;
            }

            this.cancelScheduledMount = this.whenIdle(() => {
                this.mount();
            });
        });
    }


    private mount(): void {
        this.cancelScheduledMount?.();
        this.cancelScheduledMount = null;
        const boot = this.boot;
        if (!boot || this.frame) {
            return;
        }

        const { window: win, document: doc, widgetOrigin } = this.env;
        this.frame = new FrameHost({
            document: doc,
            window: win,
            src: `${widgetOrigin}/w/${encodeURIComponent(boot.widget.widgetId)}`,
            title: 'Jendela chat',
            overrides: boot.loader,
            onReattached: () => {
                this.ready = false;
                this.armReadyTimeout();
            },
        });
        win.addEventListener('message', this.onMessage);
        win.addEventListener('resize', this.onResize);
        win.addEventListener('scroll', this.onScroll, { passive: true });
        doc.addEventListener('mouseout', this.onMouseOut);
        this.frame.attach();
        this.armReadyTimeout();
        if (boot.loader.autoPageTracking) {
            this.stopNavigation = watchNavigation(win, () => {
                this.scrolled = 0;
                this.command('page', [this.currentPage()]);
            });
        }
    }


    private armReadyTimeout(): void {
        if (this.readyTimer !== null) {
            clearTimeout(this.readyTimer);
        }
        this.readyTimer = setTimeout(() => {
            this.readyTimer = null;
            if (this.ready) {
                return;
            }

            this.fail(
                'frame_timeout',
                'widget tidak merespons dalam 10 detik dan dilepas — pastikan domain website ini terdaftar di ' +
                'pengaturan widget (Plasgos CRM → Webchat → Domain website)',
            );
            this.teardown();
        }, READY_TIMEOUT_MS);
    }


    private receive(event: MessageEvent): void {
        const frame = this.frame;
        if (!frame || !isFromPeer(event, { origin: this.env.widgetOrigin, source: frame.contentWindow })) {
            return;
        }

        const message = parseWidgetMessage(event.data);
        if (!message) {
            return;
        }

        switch (message.type) {
            case 'widget.ready':
                this.onReady();
                break;
            case 'widget.frame':
                this.onLayout(message.payload as WidgetMessages['widget.frame']);
                break;
            case 'widget.state':
                this.state = { ...(message.payload as WidgetMessages['widget.state']) };
                break;
            case 'widget.event':
                this.onWidgetEvent(message.payload as WidgetMessages['widget.event']);
                break;
        }
    }


    private onReady(): void {
        const boot = this.boot;
        if (!boot) {
            return;
        }

        this.ready = true;
        if (this.readyTimer !== null) {
            clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
        this.post(createMessage('host.init', {
            options: boot.widget,
            page: this.currentPage(),
            hostOrigin: this.env.window.location.origin,
        }));
        this.postViewport();
        const pending = this.outbox;
        this.outbox = [];
        for (const message of pending) {
            this.post(message);
        }
    }


    /** Fokus pindah ke jendela chat saat dibuka dan kembali ke elemen semula saat ditutup (aksesibilitas). */
    private onLayout(layout: FrameLayout): void {
        const wasOpen = this.state.open;
        const isOpen = layout.state === 'open';
        this.frame?.applyLayout(layout);
        if (isOpen && !wasOpen) {
            this.focusBeforeOpen ??= this.focusedHostElement();
            this.frame?.focus();
        } else if (!isOpen && wasOpen) {
            this.restoreFocus();
        }
        this.state = { ...this.state, open: isOpen };
    }


    /** Elemen halaman tenant yang sedang fokus (bukan iframe widget sendiri, bukan body). */
    private focusedHostElement(): HTMLElement | null {
        const active = this.env.document.activeElement;
        if (!(active instanceof HTMLElement) || active === this.env.document.body) {
            return null;
        }

        return active === this.frame?.iframe ? null : active;
    }


    /**
     * Kembalikan fokus ke pemicu. Fokus sedang di dalam iframe: Firefox mengabaikan `focus()` pada elemen dokumen
     * induk selama iframe masih elemen aktif — iframe dilepas fokusnya lebih dulu.
     */
    private restoreFocus(): void {
        const previous = this.focusBeforeOpen;
        this.focusBeforeOpen = null;
        if (!previous?.isConnected) {
            return;
        }

        this.frame?.blur();
        previous.focus();
    }


    private onWidgetEvent(event: WidgetMessages['widget.event']): void {
        if ((WIDGET_EVENTS as readonly string[]).includes(event.name)) {
            this.emit(event.name, event.data);
        }
    }


    private command(name: HostCommand, args: readonly unknown[]): void {
        if (!this.boot) {
            warn(`"${name}" dipanggil sebelum boot — panggil Plasgos("boot", { widgetId }) dulu`);
            return;
        }

        if (name === 'open' || name === 'toggle') {
            // Pemicu (tombol chat buatan tenant) dicatat SEKARANG — saat jendela terbuka, fokus sudah di iframe.
            this.focusBeforeOpen = this.state.open ? this.focusBeforeOpen : this.focusedHostElement();
            // Mode `interaction`: membuka chat dari tombol tenant memuat widget saat itu juga.
            if (!this.frame) {
                this.mount();
            }
        }
        const message = createMessage('host.command', { name, args });
        if (this.ready) {
            this.post(message);
            return;
        }

        if (this.outbox.length < MAX_OUTBOX) {
            this.outbox.push(message);
        }
    }


    private shutdown(): void {
        if (!this.boot) {
            return;
        }

        if (this.ready) {
            this.post(createMessage('host.command', { name: 'shutdown', args: [] }));
        }
        const frame = this.frame;
        this.frame = null;
        this.teardown();
        if (frame) {
            setTimeout(() => {
                frame.detach();
            }, SHUTDOWN_GRACE_MS);
        }
    }


    private teardown(): void {
        this.cancelScheduledMount?.();
        this.cancelScheduledMount = null;
        if (this.readyTimer !== null) {
            clearTimeout(this.readyTimer);
            this.readyTimer = null;
        }
        this.stopNavigation?.();
        this.stopNavigation = null;
        this.env.window.removeEventListener('message', this.onMessage);
        this.env.window.removeEventListener('resize', this.onResize);
        this.env.window.removeEventListener('scroll', this.onScroll);
        this.env.document.removeEventListener('mouseout', this.onMouseOut);
        if (this.viewportTimer !== null) {
            clearTimeout(this.viewportTimer);
            this.viewportTimer = null;
        }
        this.frame?.detach();
        this.frame = null;
        this.boot = null;
        this.ready = false;
        this.outbox = [];
        this.state = INITIAL_STATE;
    }


    private postViewport(): void {
        if (!this.ready) {
            return;
        }

        const { innerWidth: width, innerHeight: height } = this.env.window;
        this.post(createMessage('host.viewport', { width, height }));
    }


    private post(message: ProtocolMessage<HostMessageType>): void {
        this.frame?.contentWindow?.postMessage(message, this.env.widgetOrigin);
    }


    private on(name: unknown, handler: unknown): void {
        if (!(WIDGET_EVENTS as readonly unknown[]).includes(name) || typeof handler !== 'function') {
            warn(`on("${String(name)}") — nama event atau handler tidak valid`);
            return;
        }

        const key = name as WidgetEventName;
        const set = this.listeners.get(key) ?? new Set<EventHandler>();
        set.add(handler as EventHandler);
        this.listeners.set(key, set);
    }


    private off(name: unknown, handler: unknown): void {
        if (typeof handler === 'function') {
            this.listeners.get(name as WidgetEventName)?.delete(handler as EventHandler);
        }
    }


    private emit(name: WidgetEventName, data: unknown): void {
        for (const handler of this.listeners.get(name) ?? []) {
            try {
                handler(data);
            } catch (error) {
                warn(`handler event "${name}" milik website melempar galat`, error);
            }
        }
    }


    private fail(code: string, message: string, detail?: unknown): void {
        warn(message, detail);
        this.emit('error', { code, message });
    }


    private currentPage(): PageInfo {
        const { window: win, document: doc } = this.env;
        return { url: win.location.href, title: doc.title, referrer: doc.referrer };
    }


    private whenDomReady(callback: () => void): () => void {
        const doc = this.env.document;
        if (doc.readyState !== 'loading') {
            return this.defer(callback);
        }

        const listener = (): void => {
            callback();
        };
        doc.addEventListener('DOMContentLoaded', listener, { once: true });
        return () => {
            doc.removeEventListener('DOMContentLoaded', listener);
        };
    }


    private whenIdle(callback: () => void): () => void {
        // Safari belum punya requestIdleCallback — tipe lib DOM menganggapnya selalu ada.
        const idle = this.env.window as unknown as IdleScheduler;
        if (typeof idle.requestIdleCallback === 'function' && typeof idle.cancelIdleCallback === 'function') {
            const handle = idle.requestIdleCallback(callback, { timeout: 3000 });
            return () => {
                idle.cancelIdleCallback?.(handle);
            };
        }

        return this.defer(callback, 1);
    }


    private defer(callback: () => void, delayMs = 0): () => void {
        const timer = setTimeout(callback, delayMs);
        return () => {
            clearTimeout(timer);
        };
    }


    private onFirstInteraction(callback: () => void): () => void {
        const win = this.env.window;
        const listener = (): void => {
            stop();
            callback();
        };
        const stop = (): void => {
            for (const name of INTERACTION_EVENTS) {
                win.removeEventListener(name, listener, true);
            }
        };
        for (const name of INTERACTION_EVENTS) {
            win.addEventListener(name, listener, { capture: true, passive: true });
        }
        return stop;
    }
}
