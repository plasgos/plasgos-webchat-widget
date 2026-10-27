/**
 * `@plasgos/webchat` — paket npm inti (cara B, WEBCHAT_EMBED_COMPATIBILITY.md §2 & §4).
 *
 *   - Aman SSR: mengimpor & memanggil di server (Next/Nuxt/SvelteKit/Angular/Astro/Remix) tak menyentuh
 *     `window`/`document`; semua fungsi menjadi no-op yang langsung selesai.
 *   - Idempoten: snippet + paket terpasang bersamaan, React StrictMode, HMR → tetap satu loader & satu widget
 *     (loader & stub antrean `Plasgos` yang sama dengan snippet).
 *   - Trusted Types: `script.src` diisi lewat kebijakan `plasgos-webchat` bila website mewajibkannya
 *     (izinkan nama kebijakan itu di direktif CSP `trusted-types`).
 */

export const DEFAULT_LOADER_URL = 'https://cdn.plasgoschat.my.id/loader/v1/loader.js';

export type Locale = 'id' | 'en';
export type WebchatEventName =
    | 'ready'
    | 'open'
    | 'close'
    | 'message'
    | 'unread_changed'
    | 'conversation_started'
    | 'lead_captured'
    | 'error';

export interface WebchatOptions {
    readonly widgetId: string;
    readonly locale?: Locale;
    /** Identity token dari SERVER tenant (JWT bertanda tangan secret widget) — pengunjung terverifikasi. */
    readonly identityToken?: string;
    readonly hideLauncher?: boolean;
    readonly load?: 'idle' | 'interaction' | 'eager';
    readonly autoPageTracking?: boolean;
    readonly consentRequired?: boolean;
    readonly zIndex?: number;
    readonly position?: 'left' | 'right';
    readonly offset?: { readonly x: number; readonly y: number };
    /** Nonce CSP website — diteruskan ke tag loader. */
    readonly nonce?: string;
    /** URL loader lain (staging/uji); bawaan CDN produksi. */
    readonly loaderUrl?: string;
    /** Origin aplikasi widget (staging/uji); bawaan ditanam di build loader. */
    readonly widgetOrigin?: string;
}

export interface WebchatState {
    readonly booted: boolean;
    readonly open: boolean;
    readonly unread: number;
    readonly trustLevel: string | null;
}

export interface WebchatClient {
    open(): void;
    close(): void;
    toggle(): void;
    shutdown(): void;
    identify(token: string): void;
    page(info?: { readonly url?: string; readonly title?: string }): void;
    track(name: string, props?: Readonly<Record<string, unknown>>): void;
    consent(consent: { readonly analytics?: boolean; readonly chat?: boolean }): void;
    setLocale(locale: Locale): void;
    /** Daftarkan pendengar; kembalian = fungsi pelepas. */
    on(event: WebchatEventName, handler: (data: unknown) => void): () => void;
    getState(): WebchatState;
}

type CommandFunction = ((...args: unknown[]) => unknown) & { q?: unknown[][] };

interface ScriptUrlPolicy {
    createScriptURL(value: string): unknown;
}

interface TrustedTypesLike {
    createPolicy(name: string, rules: { createScriptURL: (value: string) => string }): ScriptUrlPolicy;
}

type HostWindow = Window & { Plasgos?: CommandFunction; trustedTypes?: TrustedTypesLike };

const LOADER_MARK = 'data-plasgos-webchat-loader';
const TRUSTED_TYPES_POLICY = 'plasgos-webchat';
const EMPTY_STATE: WebchatState = { booted: false, open: false, unread: 0, trustLevel: null };

export function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function warn(message: string, detail?: unknown): void {
    console.warn(`[Plasgos Webchat] ${message}`, ...(detail === undefined ? [] : [detail]));
}

/** Stub antrean yang sama persis dengan snippet: perintah sebelum loader siap ditahan lalu diputar ulang. */
function commandFunction(win: HostWindow): CommandFunction {
    if (!win.Plasgos) {
        const queue: CommandFunction = (...args: unknown[]): void => {
            queue.q?.push(args);
        };
        queue.q = [];
        win.Plasgos = queue;
    }
    return win.Plasgos;
}

function command(name: string, ...args: unknown[]): unknown {
    if (!isBrowser()) {
        return undefined;
    }
    try {
        return commandFunction(window)(name, ...args);
    } catch (error) {
        warn(`perintah "${name}" gagal`, error);
        return undefined;
    }
}

let trustedPolicy: ScriptUrlPolicy | null | undefined;

/** URL skrip lewat kebijakan Trusted Types bila tersedia; website tanpa Trusted Types menerima string biasa. */
function scriptUrl(win: HostWindow, url: string): string {
    if (trustedPolicy === undefined) {
        try {
            const rules = { createScriptURL: (value: string): string => value };
            trustedPolicy = win.trustedTypes?.createPolicy(TRUSTED_TYPES_POLICY, rules) ?? null;
        } catch {
            trustedPolicy = null;
        }
    }
    return (trustedPolicy ? trustedPolicy.createScriptURL(url) : url) as string;
}

/** Suntik loader sekali per halaman — snippet/plugin yang sudah memasangnya tak digandakan. */
function injectLoader(win: HostWindow, doc: Document, options: WebchatOptions): void {
    const alreadyInstalled = '__plasgosWebchat' in win
        || doc.querySelector(`script[${LOADER_MARK}]`) !== null
        // Snippet resmi memasang tag loader dengan `data-widget-id` (URL CDN apa pun: produksi, staging, versi
        // terkunci); tag loader tulisan tangan tanpa atribut itu dikenali dari path CDN-nya.
        || doc.querySelector('script[data-widget-id][src*="loader"], script[src*="/loader/v1/loader.js"]') !== null;
    if (alreadyInstalled) {
        return;
    }

    const script = doc.createElement('script');
    script.async = true;
    script.setAttribute(LOADER_MARK, '');
    script.setAttribute('data-widget-id', options.widgetId);
    if (options.widgetOrigin) {
        script.setAttribute('data-widget-origin', options.widgetOrigin);
    }
    if (options.nonce) {
        script.nonce = options.nonce;
    }
    try {
        script.src = scriptUrl(win, options.loaderUrl ?? DEFAULT_LOADER_URL);
    } catch (error) {
        warn('loader tak bisa dipasang — izinkan kebijakan Trusted Types "plasgos-webchat" di CSP website', error);
        return;
    }
    doc.head.appendChild(script);
}

/** Opsi yang diteruskan ke `boot` loader — sisanya (token, nonce, URL) urusan paket ini. */
const BOOT_KEYS = ['widgetId', 'locale', 'hideLauncher', 'load', 'autoPageTracking', 'consentRequired', 'zIndex', 'position', 'offset'] as const;

function bootOptionsOf(options: WebchatOptions): Record<string, unknown> {
    return Object.fromEntries(BOOT_KEYS.filter((key) => options[key] !== undefined).map((key) => [key, options[key]]));
}

/** Klien perintah — aman dipanggil kapan saja (sebelum loader siap ditahan di antrean; di server no-op). */
export const client: WebchatClient = {
    open: () => {
        command('open');
    },
    close: () => {
        command('close');
    },
    toggle: () => {
        command('toggle');
    },
    shutdown: () => {
        command('shutdown');
    },
    identify: (token) => {
        command('identify', { token });
    },
    page: (info) => {
        command('page', info ?? {});
    },
    track: (name, props) => {
        command('track', name, props ?? {});
    },
    consent: (consent) => {
        command('consent', consent);
    },
    setLocale: (locale) => {
        command('setLocale', locale);
    },
    on: (event, handler) => {
        command('on', event, handler);
        return () => {
            command('off', event, handler);
        };
    },
    getState: () => {
        const state = command('getState');
        return typeof state === 'object' && state !== null ? state as WebchatState : EMPTY_STATE;
    },
};

/**
 * Nyalakan widget. Loader disuntik setelah event `load` halaman (kecuali `load: "eager"`) — permintaannya tak berada
 * di depan LCP website. Idempoten: dipanggil lagi dengan widget sama tak berbuat apa-apa.
 */
export function loadWebchat(options: WebchatOptions): Promise<WebchatClient> {
    if (!isBrowser() || !options.widgetId) {
        return Promise.resolve(client);
    }

    const win = window as HostWindow;
    const send = commandFunction(win);
    send('boot', bootOptionsOf(options));
    if (options.identityToken) {
        send('identify', { token: options.identityToken });
    }
    const install = (): void => {
        injectLoader(win, document, options);
    };
    if (options.load === 'eager' || document.readyState === 'complete') {
        install();
    } else {
        win.addEventListener('load', install, { once: true });
    }
    return Promise.resolve(client);
}

/** Klien widget di halaman ini (sama untuk semua pemanggil). */
export function getWebchat(): WebchatClient {
    return client;
}
