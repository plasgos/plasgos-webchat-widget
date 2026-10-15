/**
 * Jejak halaman & event website (W8a) → `POST /webchat/v1/events`.
 *
 * - Antrean dengan debounce: navigasi beruntun di SPA dikirim sebagai SATU batch (maks. 20 event per kiriman).
 * - Persetujuan (`Plasgos('consent', { analytics })` dari pengelola cookie website): `boot({ consentRequired: true })`
 *   = MENUNGGU — event ditahan (maks. 20) sampai disetujui; ditolak = antrean dibuang dan tak ada yang dikirim lagi.
 * - Widget yang pelacakan halamannya dimatikan tenant (`privacy.page_tracking: false`) tak mengirim apa pun.
 * - Analitik tak boleh mengganggu chat: gagal kirim = batch dibuang (tanpa coba ulang, tanpa pesan ke pengunjung).
 * - Halaman ditutup: sisa antrean dikirim dengan `keepalive` agar halaman terakhir tak hilang.
 */

export type TrackingConsent = 'granted' | 'pending' | 'denied';

export interface PageViewEvent {
    readonly type: 'page_view';
    readonly url: string;
    readonly title?: string;
    readonly referrer?: string;
}

export interface TrackEvent {
    readonly type: 'track';
    readonly name: string;
    readonly properties?: Readonly<Record<string, string | number | boolean | null>>;
}

/** Jendela chat dibuka (W8c, funnel widget) — tanpa data; dicatat sekali per pengunjung di server. */
export interface WidgetOpenEvent {
    readonly type: 'widget_open';
}

export type TrackingEvent = PageViewEvent | TrackEvent | WidgetOpenEvent;

export interface TrackerOptions {
    readonly send: (events: readonly TrackingEvent[], options: { keepalive: boolean }) => Promise<unknown>;
    readonly schedule?: (callback: () => void, ms: number) => unknown;
    readonly cancel?: (handle: unknown) => void;
    readonly debounceMs?: number;
}

const BATCH_LIMIT = 20;
const PENDING_LIMIT = 20;
const QUEUE_LIMIT = 100;
const NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const PROPERTY_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
const MAX_PROPERTIES = 20;

/** Properti `track` yang sah, atau `null` bila bentuknya tak diterima server (event dibuang di sini, bukan 422). */
export function trackPropertiesOf(value: unknown): Record<string, string | number | boolean | null> | null | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_PROPERTIES) {
        return null;
    }
    const out: Record<string, string | number | boolean | null> = {};
    for (const [key, raw] of entries) {
        if (!PROPERTY_PATTERN.test(key)) {
            return null;
        }
        if (typeof raw === 'string') {
            out[key] = raw.slice(0, 200);
        } else if ((typeof raw === 'number' && Number.isFinite(raw)) || typeof raw === 'boolean' || raw === null) {
            out[key] = raw;
        } else {
            return null;
        }
    }
    return out;
}

export function isTrackName(value: unknown): value is string {
    return typeof value === 'string' && NAME_PATTERN.test(value);
}

export class PageTracker {
    private queue: TrackingEvent[] = [];
    private consent: TrackingConsent;
    private enabled = true;
    private ready = false;
    private timer: unknown = null;
    private lastUrl: string | null = null;
    private decided = false;
    private openedSent = false;
    private readonly schedule: (callback: () => void, ms: number) => unknown;
    private readonly cancel: (handle: unknown) => void;
    private readonly debounceMs: number;


    public constructor(private readonly options: TrackerOptions, consentRequired = false) {
        this.consent = consentRequired ? 'pending' : 'granted';
        this.schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
        this.cancel = options.cancel ?? ((handle) => {
            clearTimeout(handle as ReturnType<typeof setTimeout>);
        });
        this.debounceMs = options.debounceMs ?? 1500;
    }


    /** Konfigurasi widget: tenant mematikan pelacakan halaman → antrean dibuang, tak ada kiriman. */
    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            // Jejak halaman dibuang; sinyal "jendela dibuka" (funnel) tetap.
            this.queue = this.queue.filter((event) => event.type === 'widget_open');
        }
    }


    /** Sesi siap (token tersedia) — antrean yang tertahan mulai dikirim. */
    public setReady(ready: boolean): void {
        this.ready = ready;
        this.arm();
    }


    /** `boot({ consentRequired: true })`: tahan semua event sampai website menyatakan persetujuan. */
    public requireConsent(): void {
        if (!this.decided) {
            this.consent = 'pending';
        }
    }


    public setConsent(granted: boolean): void {
        this.decided = true;
        this.consent = granted ? 'granted' : 'denied';
        if (!granted) {
            this.clear();
            return;
        }
        this.arm();
    }


    public get consentState(): TrackingConsent {
        return this.consent;
    }


    /** Halaman dibuka. URL yang sama berturut-turut (muat ulang status, `replaceState` tanpa perubahan) diabaikan. */
    public pageView(page: { url: string; title?: string; referrer?: string }): void {
        if (!page.url || page.url === this.lastUrl) {
            return;
        }
        this.lastUrl = page.url;
        this.push({
            type: 'page_view',
            url: page.url.slice(0, 2000),
            ...(page.title ? { title: page.title.slice(0, 300) } : {}),
            ...(page.referrer ? { referrer: page.referrer.slice(0, 1000) } : {}),
        });
    }


    /** `Plasgos('track', name, props)` — nama/properti yang tak sah dibuang di sini. */
    public track(name: unknown, properties?: unknown): boolean {
        const props = trackPropertiesOf(properties);
        if (!isTrackName(name) || props === null) {
            return false;
        }
        this.push({ type: 'track', name, ...(props ? { properties: props } : {}) });
        return true;
    }


    /**
     * Jendela chat dibuka — sekali per sesi widget. Penghitung funnel milik tenant, BUKAN jejak halaman: tetap dikirim
     * walau tenant mematikan pelacakan halaman, tetapi tunduk pada persetujuan cookie.
     */
    public widgetOpened(): void {
        if (this.openedSent) {
            return;
        }
        this.openedSent = true;
        this.push({ type: 'widget_open' }, true);
    }


    /** Kirim sisa antrean SEKARANG (halaman ditutup / disembunyikan). */
    public flushNow(keepalive = true): void {
        if (this.timer !== null) {
            this.cancel(this.timer);
            this.timer = null;
        }
        void this.flush(keepalive);
    }


    /** Untuk uji & diagnosis. */
    public get pending(): readonly TrackingEvent[] {
        return this.queue;
    }


    private push(event: TrackingEvent, essential = false): void {
        if ((!this.enabled && !essential) || this.consent === 'denied') {
            return;
        }
        const limit = this.consent === 'pending' ? PENDING_LIMIT : QUEUE_LIMIT;
        if (this.queue.length >= limit) {
            return;
        }
        this.queue.push(event);
        this.arm();
    }


    private arm(): void {
        if (!this.canSend() || !this.queue.length || this.timer !== null) {
            return;
        }
        this.timer = this.schedule(() => {
            this.timer = null;
            void this.flush(false);
        }, this.debounceMs);
    }


    private canSend(): boolean {
        return (this.enabled || this.queue.every((event) => event.type === 'widget_open'))
            && this.ready && this.consent === 'granted';
    }


    private async flush(keepalive: boolean): Promise<void> {
        while (this.canSend() && this.queue.length) {
            const batch = this.queue.splice(0, BATCH_LIMIT);
            try {
                await this.options.send(batch, { keepalive });
            } catch {
                // Analitik tak mengganggu chat: batch gagal dibuang.
            }
        }
    }


    private clear(): void {
        this.queue = [];
        if (this.timer !== null) {
            this.cancel(this.timer);
            this.timer = null;
        }
    }
}
