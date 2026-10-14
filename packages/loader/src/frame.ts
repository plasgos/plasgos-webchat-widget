import type { FrameLayout } from '@plasgos/webchat-protocol';

import { DEFAULT_Z_INDEX } from './options';
import type { LoaderOptions } from './options';

export const ROOT_ID = 'plasgos-webchat-root';

interface ScrollLock {
    readonly bodyOverflow: string;
    readonly htmlOverflow: string;
}

export interface FrameHostConfig {
    readonly document: Document;
    readonly window: Window;
    readonly src: string;
    readonly title: string;
    readonly overrides: LoaderOptions;
    /** Root dipasang ulang setelah dicabut framework → iframe dimuat ulang (handshake ulang). */
    readonly onReattached: () => void;
}

type StyleTarget = { readonly style: CSSStyleDeclaration };

/**
 * `document.body` masih null bila loader berjalan di `<head>` sebelum body diurai — tipe lib DOM tak
 * mencerminkannya, jadi dibaca lewat `Reflect.get` dengan tipe yang jujur.
 */
function bodyOf(doc: Document): HTMLElement | null {
    const body: unknown = Reflect.get(doc, 'body');
    return body instanceof HTMLElement ? body : null;
}

function setStyles(element: StyleTarget, styles: Readonly<Record<string, string>>): void {
    for (const [name, value] of Object.entries(styles)) {
        element.style.setProperty(name, value);
    }
}

/**
 * Root `<div id="plasgos-webchat-root">` + iframe widget di akhir `<body>`. Semua gaya lewat CSSOM (tanpa
 * `<style>`, tanpa `innerHTML`) supaya lolos CSP `style-src` tanpa `'unsafe-inline'` dan Trusted Types.
 * Posisi `fixed` dengan ukuran tetap per keadaan → tanpa layout shift halaman tenant.
 */
export class FrameHost {
    public readonly root: HTMLDivElement;

    public readonly iframe: HTMLIFrameElement;

    private readonly observers: MutationObserver[] = [];

    private scrollLock: ScrollLock | null = null;

    private layout: FrameLayout | null = null;

    private bodyObserver: MutationObserver | null = null;

    private bodyCallback: (() => void) | null = null;

    private readonly onViewport = (): void => {
        this.fitViewport();
    };


    public constructor(private readonly config: FrameHostConfig) {
        const doc = config.document;
        this.root = doc.createElement('div');
        this.root.id = ROOT_ID;
        this.iframe = doc.createElement('iframe');
        this.iframe.src = config.src;
        this.iframe.title = config.title;
        setStyles(this.root, {
            position: 'fixed',
            display: 'none',
            margin: '0',
            padding: '0',
            border: '0',
            overflow: 'hidden',
            background: 'transparent',
            'z-index': String(config.overrides.zIndex ?? DEFAULT_Z_INDEX),
        });
        // `color-scheme` sama di kedua sisi → latar iframe tetap transparan di tema gelap website.
        setStyles(this.iframe, {
            display: 'block',
            width: '100%',
            height: '100%',
            border: '0',
            margin: '0',
            background: 'transparent',
            'color-scheme': 'normal',
        });
        this.root.appendChild(this.iframe);
    }


    public get contentWindow(): Window | null {
        return this.iframe.contentWindow;
    }


    public attach(): void {
        this.mount();
        this.watchRemoval();
    }


    public detach(): void {
        for (const observer of this.observers) {
            observer.disconnect();
        }
        this.observers.length = 0;
        this.config.window.visualViewport?.removeEventListener('resize', this.onViewport);
        this.unlockScroll();
        this.root.remove();
    }


    public focus(): void {
        this.iframe.focus();
    }


    public blur(): void {
        this.iframe.blur();
    }


    /** Terapkan tata letak dari widget; opsi `boot` tenant (posisi, offset, z-index) menang atas nilai server. */
    public applyLayout(layout: FrameLayout): void {
        this.layout = layout;
        const overrides = this.config.overrides;
        const position = overrides.position ?? layout.position;
        const x = overrides.offset?.x ?? layout.offsetX;
        const y = overrides.offset?.y ?? layout.offsetY;
        const zIndex = overrides.zIndex ?? layout.zIndex ?? DEFAULT_Z_INDEX;

        if (layout.state === 'hidden') {
            setStyles(this.root, { display: 'none' });
            this.unlockScroll();
            return;
        }

        if (layout.fullscreen) {
            // Batas lebar/tinggi tata letak sebelumnya (launcher/jendela) WAJIB dikosongkan — tanpa itu layar penuh
            // tertahan `calc(100vw - offset)`.
            setStyles(this.root, {
                display: 'block',
                top: '0',
                left: '0',
                right: '0',
                bottom: 'auto',
                width: '100%',
                height: '100%',
                'max-width': 'none',
                'max-height': 'none',
                'z-index': String(zIndex),
            });
            this.lockScroll();
            this.config.window.visualViewport?.addEventListener('resize', this.onViewport);
            this.fitViewport();
            return;
        }

        this.config.window.visualViewport?.removeEventListener('resize', this.onViewport);
        this.unlockScroll();
        setStyles(this.root, {
            display: 'block',
            top: 'auto',
            bottom: `${y}px`,
            left: position === 'left' ? `${x}px` : 'auto',
            right: position === 'right' ? `${x}px` : 'auto',
            width: `${layout.width}px`,
            height: `${layout.height}px`,
            'max-width': `calc(100vw - ${x}px)`,
            'max-height': `calc(100vh - ${y}px)`,
            'z-index': String(zIndex),
        });
    }


    /** Keyboard virtual iOS mengecilkan visual viewport — jendela layar penuh mengikuti area yang terlihat. */
    private fitViewport(): void {
        const viewport = this.config.window.visualViewport;
        if (!viewport || !this.layout?.fullscreen) {
            return;
        }

        setStyles(this.root, { top: `${viewport.offsetTop}px`, height: `${viewport.height}px` });
    }


    private mount(): void {
        const doc = this.config.document;
        (bodyOf(doc) ?? doc.documentElement).appendChild(this.root);
    }


    /**
     * Framework yang mengganti isi/elemen `<body>` saat navigasi (Turbo/Hotwire, beberapa SSG) mencabut root →
     * dipasang ulang. Pengamat ringan: hanya anak langsung `<html>` dan `<body>`, bukan seluruh pohon.
     */
    private watchRemoval(): void {
        const doc = this.config.document;
        const restore = (): void => {
            if (this.root.isConnected) {
                return;
            }

            this.mount();
            this.observeBody();
            this.config.onReattached();
        };
        const htmlObserver = new MutationObserver(restore);
        htmlObserver.observe(doc.documentElement, { childList: true });
        this.observers.push(htmlObserver);
        this.observeBody(restore);
    }


    private observeBody(callback?: () => void): void {
        if (callback) {
            this.bodyCallback = callback;
        }
        const body = bodyOf(this.config.document);
        if (!body || !this.bodyCallback) {
            return;
        }

        this.bodyObserver?.disconnect();
        const observer = new MutationObserver(this.bodyCallback);
        observer.observe(body, { childList: true });
        this.bodyObserver = observer;
        this.observers.push(observer);
    }


    /** Layar penuh di mobile: halaman tenant tak ikut ter-scroll; nilai semula dikembalikan saat ditutup. */
    private lockScroll(): void {
        if (this.scrollLock) {
            return;
        }

        const doc = this.config.document;
        this.scrollLock = { bodyOverflow: doc.body.style.overflow, htmlOverflow: doc.documentElement.style.overflow };
        doc.body.style.overflow = 'hidden';
        doc.documentElement.style.overflow = 'hidden';
    }


    private unlockScroll(): void {
        if (!this.scrollLock) {
            return;
        }

        const doc = this.config.document;
        doc.body.style.overflow = this.scrollLock.bodyOverflow;
        doc.documentElement.style.overflow = this.scrollLock.htmlOverflow;
        this.scrollLock = null;
    }
}
