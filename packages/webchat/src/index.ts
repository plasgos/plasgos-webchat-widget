/**
 * `@plasgos/webchat` — paket npm inti (cara B, WEBCHAT_EMBED_COMPATIBILITY.md §2).
 *
 * Aturan yang berlaku sejak kerangka ini: mengimpor paket di server (SSR Next/Nuxt/SvelteKit/Angular/Astro/Remix)
 * TIDAK menyentuh `window`/`document`; di luar browser setiap fungsi mengembalikan Promise yang langsung selesai
 * tanpa efek. Pemuatan loader & perintah lengkap diisi di W3d.
 */

export interface WebchatOptions {
    readonly widgetId: string;
    readonly locale?: 'id' | 'en';
    readonly identityToken?: string;
    readonly hideLauncher?: boolean;
}

export function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** Menyalakan widget. Di server: no-op yang langsung selesai. */
export function loadWebchat(options: WebchatOptions): Promise<void> {
    if (!isBrowser() || !options.widgetId) {
        return Promise.resolve();
    }

    return Promise.resolve();
}
