import { PROTOCOL_VERSION } from '@plasgos/webchat-protocol';

import { WebchatController } from './controller';
import { installGlobal } from './global';
import { warn } from './log';

/** Origin aplikasi widget lingkungan ini — ditanam saat build (`PLASGOS_WIDGET_ORIGIN`, lihat build.mjs). */
declare const __WIDGET_ORIGIN__: string;

/** Peramban lama (Internet Explorer dkk.): loader keluar diam-diam tanpa galat. */
export function isSupported(win: Window): boolean {
    return typeof win.postMessage === 'function'
        && typeof Promise === 'function'
        && typeof MutationObserver === 'function'
        && typeof Array.prototype.includes === 'function';
}

function originOf(value: string | undefined): string | null {
    if (!value) {
        return null;
    }

    try {
        const url = new URL(value);
        // http hanya untuk loopback (pengembangan): di produksi token identitas & perintah tak boleh lewat teks polos.
        return url.protocol === 'https:' || (url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))
            ? url.origin
            : null;
    } catch {
        return null;
    }
}

/**
 * Titik masuk loader. `<script>` loader boleh membawa:
 *   data-widget-id      id widget (snippet & bentuk tanpa inline)
 *   data-auto-boot      "true" → boot tanpa skrip inline (situs dengan CSP/Trusted Types ketat)
 *   data-widget-origin  origin aplikasi widget, menimpa nilai build (staging/uji)
 */
export function start(win: Window, doc: Document): void {
    if (!isSupported(win)) {
        return;
    }

    const script = doc.currentScript instanceof HTMLScriptElement ? doc.currentScript : null;
    const override = script?.dataset['widgetOrigin'];
    const widgetOrigin = originOf(override) ?? __WIDGET_ORIGIN__;
    if (override && !originOf(override)) {
        warn(`data-widget-origin "${override}" bukan origin https — memakai ${widgetOrigin}`);
    }

    const controller = new WebchatController({ window: win, document: doc, widgetOrigin });
    const { created } = installGlobal(win, PROTOCOL_VERSION, (name, args) => controller.handle(name, args));
    if (!created) {
        return;
    }

    const widgetId = script?.dataset['widgetId'];
    if (script?.dataset['autoBoot'] === 'true' && widgetId) {
        controller.handle('boot', [{ widgetId }]);
    }
}
