/**
 * APLIKASI WIDGET — berjalan di dalam iframe dari origin widget Plasgos (`/w/:widget_id`, dilayani api-crm).
 * Semua jaringan (REST `/webchat/v1`, socket `/webchat`) dan storage ada di sini, tidak pernah di halaman tenant.
 *
 * W3a: kerangka build & anggaran ukuran. Isi aplikasi (launcher, jendela chat, kirim/terima, reconnect,
 * multi-tab, i18n, aksesibilitas) diisi di W3c.
 */
import { PROTOCOL_VERSION } from '@plasgos/webchat-protocol';

const ROOT_ID = 'plasgos-webchat-app';

function widgetIdOfScript(): string | null {
    const script = document.currentScript;
    return script instanceof HTMLScriptElement ? script.dataset['widgetId'] ?? null : null;
}

const root = document.getElementById(ROOT_ID);
if (root) {
    root.dataset['protocol'] = String(PROTOCOL_VERSION);
    root.dataset['widgetId'] = widgetIdOfScript() ?? '';
}
