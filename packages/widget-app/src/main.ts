/**
 * APLIKASI WIDGET — titik masuk di dokumen iframe `/w/:widget_id` (api-crm), dimuat dari CDN
 * `widget-app/v1/app.js` dengan `data-widget-id`. Semua jaringan (REST `/webchat/v1`, socket `/webchat`) dan storage
 * ada di sini, tak pernah di halaman tenant; ke loader hanya lewat protokol postMessage v1.
 */
import { WIDGET_ID_PATTERN } from '@plasgos/webchat-protocol';

import { WidgetApp } from './app';
import type { HostPort } from './app';
import { HostBridge, parentOriginOf } from './bridge';
import { standaloneApi, stripIdentityFragment } from './standalone';

const ROOT_ID = 'plasgos-webchat-app';

function widgetIdOf(doc: Document): string | null {
    const script = doc.currentScript;
    const fromScript = script instanceof HTMLScriptElement ? script.dataset['widgetId'] : undefined;
    const fromPath = doc.location.pathname.split('/').pop();
    const candidate = fromScript ?? fromPath ?? '';
    return WIDGET_ID_PATTERN.test(candidate) ? candidate : null;
}

function boot(win: Window, doc: Document, widgetId: string): void {
    const container = doc.getElementById(ROOT_ID) ?? doc.body;
    const parentOrigin = parentOriginOf(win, doc);
    const embedded = win.parent !== win && parentOrigin !== null;

    if (!embedded) {
        // Dibuka langsung (halaman penuh / WebView): tanpa loader, jendela chat langsung terbuka.
        const host: HostPort = { frame: () => undefined, state: () => undefined, event: () => undefined };
        const page = stripIdentityFragment(win.location, (url) => {
            win.history.replaceState(win.history.state, '', url);
        });
        if (page.stripped) {
            console.warn('[Plasgos Webchat] #identity_token diabaikan — aplikasi memberi token lewat Plasgos("identify", { token })');
        }
        const app = new WidgetApp({ window: win, document: doc, container, widgetId, host });
        app.init({
            options: { widgetId },
            page: { url: page.url, title: doc.title, referrer: doc.referrer },
            hostOrigin: win.location.origin,
        });
        Reflect.set(win, 'Plasgos', standaloneApi((command) => {
            app.command(command);
        }));
        app.openStandalone();
        return;
    }

    let app: WidgetApp | null = null;
    const bridge = new HostBridge(win, parentOrigin, {
        onInit: (payload) => app?.init(payload),
        onCommand: (payload) => {
            app?.command(payload);
        },
        onViewport: (payload) => {
            app?.setViewport(payload);
        },
        onActivity: (payload) => {
            app?.activity(payload);
        },
    });
    app = new WidgetApp({ window: win, document: doc, container, widgetId, host: bridge });
    bridge.start();
}

const widgetId = widgetIdOf(document);
if (widgetId) {
    boot(window, document, widgetId);
} else {
    console.warn('[Plasgos Webchat] id widget tidak ditemukan di dokumen iframe');
}
