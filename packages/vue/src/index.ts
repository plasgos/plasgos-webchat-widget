/**
 * `@plasgos/webchat-vue` — plugin & composable Vue 3 (WEBCHAT_EMBED_COMPATIBILITY.md §6.5–6.6).
 *
 *   createApp(App).use(PlasgosWebchatPlugin, { widgetId: 'wgt_…', router }).mount('#app');
 *   const webchat = usePlasgosWebchat(); webchat.open(); webchat.state.value.unread;
 *
 * Nuxt 3: pasang di `plugins/plasgos-webchat.client.ts` (hanya peramban). Aman SSR: di server tak memuat apa pun.
 * Dengan `router`, navigasi dilaporkan dari `router.afterEach` dan deteksi otomatis loader dimatikan (tanpa
 * laporan halaman ganda).
 */
import { inject, readonly, ref } from 'vue';
import type { App, InjectionKey, Plugin, Ref } from 'vue';

import { getWebchat, isBrowser, loadWebchat } from '@plasgos/webchat';
import type { WebchatClient, WebchatOptions, WebchatState } from '@plasgos/webchat';

export type { WebchatClient, WebchatOptions, WebchatState } from '@plasgos/webchat';

/** Bentuk minimal Vue Router yang dipakai — tanpa ketergantungan paket vue-router. */
export interface RouterLike {
    afterEach(hook: () => void): unknown;
}

export interface PlasgosWebchatPluginOptions extends WebchatOptions {
    readonly router?: RouterLike;
}

export interface WebchatHandle extends WebchatClient {
    /** Keadaan widget (reaktif, hanya-baca). */
    readonly state: Readonly<Ref<WebchatState>>;
    /** Login: token dari server tenant → identify. Logout: `null` → shutdown lalu sesi anonim baru. */
    setIdentityToken(token: string | null): void;
}

export const WEBCHAT_KEY: InjectionKey<WebchatHandle> = Symbol('plasgos-webchat');

const EMPTY_STATE: WebchatState = { booted: false, open: false, unread: 0, trustLevel: null };
const STATE_EVENTS = ['ready', 'open', 'close', 'unread_changed', 'error'] as const;

/** Opsi widget tanpa token identitas — boot sesi anonim setelah logout. */
function withoutIdentity(options: WebchatOptions): WebchatOptions {
    const copy: { -readonly [K in keyof WebchatOptions]: WebchatOptions[K] } = { ...options };
    delete copy.identityToken;
    return copy;
}

function createHandle(options: WebchatOptions): WebchatHandle {
    const client = getWebchat();
    const state = ref<WebchatState>({ ...EMPTY_STATE });
    let identity: string | null = options.identityToken ?? null;
    let signedOutDeclared = options.identityToken === null;
    if (isBrowser()) {
        for (const event of STATE_EVENTS) {
            client.on(event, () => {
                state.value = { ...client.getState() };
            });
        }
    }
    return {
        ...client,
        state: readonly(state),
        setIdentityToken: (token) => {
            if (token && token !== identity) {
                client.identify(token);
            } else if (!token && identity) {
                client.shutdown();
                void loadWebchat(withoutIdentity(options));
            } else if (token === null && !signedOutDeclared) {
                // Halaman pertama tanpa pengguna (logout lewat redirect/SSR): sesi hasil login sebelumnya diakhiri.
                client.identify(null);
            }
            signedOutDeclared = token === null;
            identity = token;
        },
    };
}

export const PlasgosWebchatPlugin: Plugin<[PlasgosWebchatPluginOptions]> = {
    install(app: App, pluginOptions: PlasgosWebchatPluginOptions) {
        const { router, ...widget } = pluginOptions;
        const options: WebchatOptions = router ? { autoPageTracking: false, ...widget } : widget;
        const handle = createHandle(options);
        app.provide(WEBCHAT_KEY, handle);
        app.config.globalProperties['$webchat'] = handle;
        if (!isBrowser()) {
            return;
        }
        void loadWebchat(options);
        // Hanya URL yang BENAR-BENAR berubah: afterEach juga terpanggil untuk navigasi awal (halaman awal sudah
        // dilaporkan loader saat boot), dan plugin bisa terpasang sebelum atau sesudah navigasi awal itu.
        let reportedUrl = window.location.href;
        router?.afterEach(() => {
            // Judul halaman umumnya diperbarui SETELAH navigasi selesai.
            setTimeout(() => {
                const url = window.location.href;
                if (url === reportedUrl) {
                    return;
                }
                reportedUrl = url;
                handle.page({ url, title: document.title });
            }, 0);
        });
    },
};

/** Klien widget di komponen. Tanpa plugin terpasang → klien dasar (keadaan statis) + peringatan. */
export function usePlasgosWebchat(): WebchatHandle {
    const handle = inject(WEBCHAT_KEY, null);
    if (handle) {
        return handle;
    }
    console.warn('[Plasgos Webchat] usePlasgosWebchat() dipanggil tanpa PlasgosWebchatPlugin terpasang');
    return { ...getWebchat(), state: readonly(ref(EMPTY_STATE)), setIdentityToken: () => undefined };
}
