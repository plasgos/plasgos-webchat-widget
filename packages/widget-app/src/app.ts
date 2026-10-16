import type { FrameLayout, HostMessages, WidgetEventName, WidgetMessages } from '@plasgos/webchat-protocol';

import { ApiError, PublicApi } from './api';
import { showCaptcha } from './captcha';
import { resolveLocale } from './i18n';
import { frameLayout, MOBILE_BREAKPOINT } from './layout';
import type { Viewport } from './layout';
import { Realtime } from './realtime';
import type { ServerEvents } from './realtime';
import { FATAL_SESSION_CODES, SessionManager } from './session';
import { NotificationSound } from './sound';
import { createStore, storageKeys } from './storage';
import type { KeyValueStore } from './storage';
import { applyInboundStatus, availabilityOf, INITIAL_STATE, lastServerTimestamp, Store, upsertMessages } from './store';
import type { AppState } from './store';
import { createTabChannel } from './tabs';
import { PageTracker } from './tracking';
import { ProactiveEngine } from './proactive';
import type { TabChannel } from './tabs';
import type { ChatMessage, Locale, PageInfo, ProactiveMessage, Session, WidgetConfig } from './types';
import type { OfflineValues } from './ui/offline';
import type { PrechatValues } from './ui/prechat';
import { ChatView } from './ui/view';

/** Jeda coba ulang antrean kirim saat jaringan/server bermasalah. */
/** Galat lampiran — ditampilkan ke pengunjung, pesannya ditandai gagal (bisa dicoba lagi). */
const ATTACHMENT_ERROR_CODES: readonly string[] = [
    'attachments_disabled', 'attachment_not_allowed', 'attachment_too_large', 'attachment_rejected',
    'attachment_not_found', 'attachments_unavailable', 'upload_failed', 'postback_invalid',
];

const RETRY_STEPS_MS = [2000, 5000, 10000, 30000];
/** Galat boot yang bukan sementara & bukan fatal dicoba ulang sebanyak ini, lalu berhenti dengan pemberitahuan. */
const MAX_START_ATTEMPTS = 6;
/** Tab lain yang logout: tab ini menunggu sebentar agar sesi baru tab itu dipakai bersama (satu pengunjung). */
const TAB_RESTART_DELAY_MS = 1200;

/** Keadaan milik SATU pengunjung — dikosongkan saat sesinya berakhir (logout, ganti akun, logout di tab lain). */
const VISITOR_STATE_RESET: Partial<AppState> = {
    messages: [], unread: 0, conversationId: null, trustLevel: null, prechatPending: false, prechatError: null,
    emailOnFile: false, offlineError: null, conversationStatus: 'open', survey: null, surveyBusy: false, surveyError: null,
    transcript: null, handoffActive: false, handoffBusy: false, teaser: null, whatsappUrl: null, whatsappLinked: null,
    otp: null, notice: null, agentTypingUntil: 0,
};
const MEDIA_REFRESH_MS = 30_000;
const TYPING_THROTTLE_MS = 2500;
const TYPING_IDLE_MS = 3000;
/** Konfigurasi (jam kerja, estimasi balas) dibaca ulang berkala; tepat saat jam buka tiba status dibuka lokal dulu. */
const CONFIG_REFRESH_MS = 5 * 60 * 1000;
const CONFIG_REFRESH_MIN_MS = 30 * 1000;

/** Sisi loader yang dilihat aplikasi (postMessage ke halaman tenant). */
export interface HostPort {
    frame(layout: FrameLayout): void;
    state(state: WidgetMessages['widget.state']): void;
    event(name: WidgetEventName, data?: unknown): void;
}

export interface AppEnvironment {
    readonly window: Window;
    readonly document: Document;
    readonly container: HTMLElement;
    readonly widgetId: string;
    readonly host: HostPort;
}

type Payload<K extends keyof ServerEvents> = Parameters<ServerEvents[K]>[0];

/**
 * Aplikasi widget di dalam iframe: konfigurasi → sesi → riwayat → realtime; kirim pesan optimistis dengan antrean
 * coba ulang; tanda sampai/dibaca; belum dibaca + suara; sinkron antar-tab; perintah dari loader.
 */
/**
 * `identify` dengan `{ token: null }` eksplisit = website menyatakan TAK ADA yang login (loader: `boot` dengan
 * `identityToken: null`, mis. halaman server-rendered setelah logout) — bukan sekadar "tanpa token".
 */
function isSignedOut(value: unknown): boolean {
    return typeof value === 'object' && value !== null && Reflect.has(value, 'token') && Reflect.get(value, 'token') === null;
}


/** Argumen perintah `identify`: `{ token }` (bentuk resmi) atau string token. */
function identityTokenOf(value: unknown): string | null {
    const token: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'token') : value;
    return typeof token === 'string' && token.length > 0 && token.length <= 8192 ? token : null;
}


/** Galat OTP → kode tampilan panel (`otp_wrong` membawa sisa percobaan, `rate_limited` membawa detik tunggu). */
function otpErrorOf(error: unknown): { code: string; vars?: Record<string, string | number> } {
    if (!(error instanceof ApiError)) {
        return { code: 'unknown' };
    }
    if (error.code === 'otp_invalid') {
        const left = error.details?.['attempts_left'];
        return typeof left === 'number' ? { code: 'otp_wrong', vars: { attempts: left } } : { code: 'otp_expired' };
    }
    if (error.code === 'rate_limited') {
        return { code: 'rate_limited', vars: { seconds: error.retryAfterSeconds ?? 60 } };
    }
    return { code: error.code };
}


export class WidgetApp {
    private readonly store = new Store(INITIAL_STATE);

    private readonly api: PublicApi;

    private readonly storage: KeyValueStore;

    private readonly tabs: TabChannel;

    private readonly session: SessionManager;

    private readonly realtime: Realtime;

    /** Jejak halaman & event website (W8a) — patuh persetujuan cookie & pengaturan tenant. */
    private readonly tracker: PageTracker;

    /** Pemicu pesan proaktif (W8b): widget menilai kapan, server memutuskan boleh. */
    private readonly proactive: ProactiveEngine;

    private readonly view: ChatView;

    private readonly sound: NotificationSound;

    private readonly keys: ReturnType<typeof storageKeys>;

    private page: PageInfo;

    private hostOrigin: string;

    private hideLauncher = false;

    /** Identity token dari website yang menunggu sesi siap (perintah `identify` sebelum/di tengah boot). */
    private pendingIdentity: string | null = null;
    private pendingSignOut = false;

    private identifying = false;

    private viewport: Viewport = { width: 1280, height: 800 };

    private started = false;

    private sending = false;

    /** Berkas pesan berlampiran yang belum terkirim (W7a) — di memori tab ini saja, bukan di store/antar-tab. */
    private readonly uploads = new Map<string, { file: Blob; attachmentId: string | null }>();

    private mediaRefreshedAt = 0;

    /** Pilihan yang diklik & belum terkirim (W7b) — `client_message_id` → postback. */
    private readonly postbacks = new Map<string, { message_id: string; id: string }>();

    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    private retryAttempt = 0;

    private typingIdleTimer: ReturnType<typeof setTimeout> | null = null;

    private typingRenderTimer: ReturnType<typeof setTimeout> | null = null;

    private lastTypingSentAt = 0;

    private lastLayout = '';

    private lastPublished = '';

    private preferredLocale: Locale | undefined;

    private lastUnread = 0;

    private configTimer: ReturnType<typeof setTimeout> | null = null;

    private referrer = '';

    private whatsappPending = false;

    /** Naik setiap sesi pengunjung berakhir — hasil async milik sesi lama dibuang, tak masuk ke sesi baru. */
    private generation = 0;

    private startAttempts = 0;

    /** Halaman chat penuh `/m/` (bukan iframe di website): jendela selalu terbuka, logout = sesi anonim baru. */
    private standalone = false;

    /**
     * `conversation_started` dipancarkan saat id percakapan pertama kali diketahui SETELAH sesi siap — dari mana pun
     * datangnya (status pesan, pesan tim, riwayat, formulir offline); percakapan yang sudah ada saat muat bukan
     * "mulai".
     */
    private watchConversation = false;


    public constructor(private readonly env: AppEnvironment) {
        const win = env.window;
        this.api = new PublicApi(win.location.origin, (input, init) => win.fetch(input, init));
        this.storage = createStore(win);
        this.keys = storageKeys(env.widgetId);
        this.tabs = createTabChannel(win, env.widgetId);
        const locks = lockManagerOf(win.navigator);
        this.session = new SessionManager({
            api: this.api,
            storage: this.storage,
            refreshKey: this.keys.refresh,
            widgetId: env.widgetId,
            tabs: this.tabs,
            locks,
            now: () => Date.now(),
        });
        this.tracker = new PageTracker({
            send: (events, { keepalive }) => this.session.withToken(
                (token) => this.api.events(token, events, { keepalive }),
            ),
        });
        win.addEventListener('pagehide', () => {
            this.tracker.flushNow(true);
        });
        this.proactive = new ProactiveEngine({ claim: (ruleId) => this.claimProactive(ruleId) });
        this.realtime = new Realtime(win.location.origin, () => this.session.token, {
            onEvent: (name, payload) => {
                this.onServerEvent(name, payload);
            },
            onConnected: (reconnected) => {
                void this.onConnected(reconnected);
            },
            onDisconnected: () => {
                if (!this.store.get().notice?.fatal) {
                    this.store.update({ connection: 'offline' });
                }
            },
            onRejected: (reason) => {
                this.fatal(reason);
            },
            onTokenStale: () => {
                void this.refreshAndReconnect();
            },
        });
        this.sound = new NotificationSound(win);
        this.page = { url: '', title: '' };
        this.hostOrigin = win.location.origin;
        this.view = new ChatView(env.document, {
            toggle: () => {
                this.setOpen(!this.store.get().open);
            },
            close: () => {
                this.setOpen(false);
                this.view.focusLauncher();
            },
            send: (text) => {
                this.send(text);
            },
            attach: (file) => {
                this.attach(file);
            },
            choose: (messageId, item) => {
                this.choose(messageId, item);
            },
            mediaExpired: () => {
                // Tautan lampiran privat berumur 15 menit — gambar gagal dimuat = ambil ulang riwayat (≤ 1×/30 dtk).
                const now = Date.now();
                if (now - this.mediaRefreshedAt < MEDIA_REFRESH_MS) {
                    return;
                }
                this.mediaRefreshedAt = now;
                void this.syncHistory().catch(() => undefined);
            },
            retry: (clientMessageId) => {
                this.retry(clientMessageId);
            },
            typing: () => {
                this.visitorTyping();
            },
            toggleSound: () => {
                this.toggleSound();
            },
            interact: () => {
                this.sound.unlock();
            },
            submitPrechat: (values) => {
                void this.submitPrechat(values);
            },
            skipPrechat: () => {
                this.skipPrechat();
            },
            openOtp: () => {
                this.store.update({ otp: { step: 'email', email: '', busy: false, error: null } });
            },
            requestOtp: (email) => {
                void this.requestOtp(email);
            },
            verifyOtp: (code) => {
                void this.verifyOtp(code);
            },
            otpChangeEmail: () => {
                this.updateOtp({ step: 'email', error: null });
            },
            submitOffline: (values) => {
                void this.submitOffline(values);
            },
            rate: (score) => {
                void this.submitSurvey({ score });
            },
            surveyComment: (text) => {
                void this.submitSurvey({ comment: text });
            },
            openTranscript: () => {
                this.store.update({ transcript: { busy: false, sent: false, error: null } });
            },
            closeTranscript: () => {
                this.store.update({ transcript: null });
            },
            sendTranscript: (email) => {
                void this.sendTranscript(email);
            },
            requestHandoff: () => {
                void this.requestHandoff();
            },
            openTeaser: () => {
                this.setOpen(true);
            },
            dismissTeaser: () => {
                this.store.update({ teaser: null });
            },
        });
        this.view.mount(env.container);
        let previousConversation: string | null = null;
        this.store.subscribe((state) => {
            if (this.watchConversation && previousConversation === null && state.conversationId !== null) {
                this.env.host.event('conversation_started', {});
            }
            previousConversation = state.conversationId;
            this.render(state);
        });
        this.tabs.onMessage((message) => {
            this.onTabMessage(message);
        });
        env.document.addEventListener('visibilitychange', () => {
            this.store.update({ visible: env.document.visibilityState === 'visible' });
            if (env.document.visibilityState === 'hidden') {
                this.tracker.flushNow(true);
            }
            if (this.isReading()) {
                this.markRead();
            }
        });
    }


    /** `host.init` dari loader (atau mode mandiri). Dipanggil sekali; init berikutnya diabaikan. */
    public init(payload: HostMessages['host.init']): void {
        if (this.started) {
            return;
        }
        this.started = true;
        if (payload.resetSession === true) {
            // Logout website sebelum iframe siap: sesi tersimpan milik pengunjung sebelumnya tak dilanjutkan.
            this.storage.remove(this.keys.refresh);
        }
        this.page = { url: payload.page.url, title: payload.page.title };
        this.hostOrigin = payload.hostOrigin;
        this.hideLauncher = payload.options.hideLauncher === true;
        this.store.update({
            locale: payload.options.locale ?? 'id',
            soundEnabled: this.storage.get(this.keys.sound) !== 'off',
            visible: this.env.document.visibilityState === 'visible',
        });
        this.preferredLocale = payload.options.locale;
        if (payload.options.consentRequired === true) {
            this.tracker.requireConsent();
        }
        this.referrer = payload.page.referrer;
        void this.start(payload.page.referrer);
    }


    public command(payload: HostMessages['host.command']): void {
        const [first] = payload.args;
        switch (payload.name) {
            case 'open':
                this.setOpen(true);
                break;
            case 'close':
                this.setOpen(false);
                break;
            case 'toggle':
                this.setOpen(!this.store.get().open);
                break;
            case 'shutdown':
                // Iframe dicabut loader setelah ini; halaman penuh `/m/` tetap hidup → langsung sesi anonim baru.
                void this.shutdown().then(() => (this.standalone ? this.start() : undefined));
                break;
            case 'page': {
                const page = pageOf(first);
                if (page) {
                    this.page = page;
                    this.tracker.pageView(page);
                    this.proactive.page();
                }
                break;
            }
            case 'setLocale':
                if (first === 'id' || first === 'en') {
                    this.store.update({ locale: first });
                }
                break;
            case 'identify':
                this.pendingSignOut = isSignedOut(first);
                this.pendingIdentity = identityTokenOf(first);
                void (this.pendingSignOut ? this.applySignOut() : this.applyIdentity());
                break;
            case 'track':
                if (typeof first === 'string') {
                    this.proactive.event(first);
                }
                if (!this.tracker.track(first, payload.args[1])) {
                    this.env.host.event('error', { code: 'invalid_track', message: 'Nama event: huruf, angka, _ . : - (maks. 64); properti datar maks. 20' });
                }
                break;
            case 'consent': {
                const analytics = consentOf(first);
                if (analytics !== null) {
                    this.tracker.setConsent(analytics);
                }
                break;
            }
        }
    }


    /** Sinyal halaman dari loader (W8b): kedalaman gulir & niat keluar → pemicu proaktif. */
    public activity(payload: { readonly scroll?: number; readonly exit?: boolean }): void {
        if (typeof payload.scroll === 'number') {
            this.proactive.scroll(payload.scroll);
        }
        if (payload.exit === true) {
            this.proactive.exitIntent();
        }
    }


    public setViewport(viewport: Viewport): void {
        this.viewport = viewport;
        this.render(this.store.get());
    }


    /** Mode mandiri (dokumen dibuka langsung, bukan dalam iframe website): jendela langsung terbuka. */
    public openStandalone(): void {
        this.standalone = true;
        this.setOpen(true);
    }


    private async start(referrer = '', captchaToken: string | null = null): Promise<void> {
        const generation = this.generation;
        try {
            if (!this.store.get().config) {
                const config = await this.api.config(this.env.widgetId);
                this.applyConfig(config);
                // Konfigurasi tanpa `appearance` (server lama/terpotong) tak boleh menggagalkan boot.
                const { appearance } = config as { appearance?: Partial<WidgetConfig['appearance']> };
                this.store.update({ locale: resolveLocale(this.preferredLocale, appearance?.locale_default ?? 'id') });
            }
            const session = await this.session.start({
                page_origin: this.hostOrigin,
                page: {
                    url: this.page.url.slice(0, 2000),
                    title: this.page.title.slice(0, 300),
                    ...(referrer ? { referrer: referrer.slice(0, 1000) } : {}),
                },
                locale: this.store.get().locale,
                ...(captchaToken ? { captcha_token: captchaToken } : {}),
            });
            if (generation !== this.generation) {
                return;
            }
            this.startAttempts = 0;
            // Halaman pendaratan = jejak pertama kunjungan; navigasi berikutnya lewat perintah `page` (loader).
            this.tracker.pageView({ ...this.page, referrer: this.referrer });
            this.tracker.setReady(true);
            this.store.update({
                trustLevel: session.trust_level,
                conversationId: session.conversation?.id ?? null,
                captchaSiteKey: null,
                notice: null,
                connection: 'connecting',
                prechatPending: this.needsPrechat(session),
                emailOnFile: session.email_on_file === true,
            });
            // Selalu dari catatan pengunjung di server — `session.conversation` masih null bila pesan terakhir baru
            // diterima (antre) saat halaman dimuat ulang.
            await this.syncHistory();
            this.watchConversation = true;
            this.realtime.connect();
            // Pesan proaktif hanya untuk pengunjung yang belum bercakap (server memeriksa ulang).
            if (!this.store.get().conversationId) {
                this.proactive.start();
            }
            this.env.host.event('ready');
            await this.applySignOut();
            await this.applyIdentity();
        } catch (error) {
            if (generation === this.generation) {
                this.onStartError(error, referrer);
            }
        }
    }


    private onStartError(error: unknown, referrer: string): void {
        this.startAttempts += 1;
        const retry = (delay: number): void => {
            const generation = this.generation;
            setTimeout(() => {
                if (generation === this.generation) {
                    void this.start(referrer);
                }
            }, delay);
        };
        if (!(error instanceof ApiError)) {
            // Galat tak terduga (jaringan putus di tengah, data tak lengkap): dicoba ulang — dulu widget macet.
            this.store.update({ notice: { code: 'unknown', fatal: false } });
            if (this.startAttempts < MAX_START_ATTEMPTS) {
                retry(this.nextRetryDelay());
            }
            return;
        }

        if (error.code === 'captcha_required') {
            const siteKey = typeof error.details?.['site_key'] === 'string' ? error.details['site_key'] : this.store.get().config?.captcha.site_key ?? null;
            this.store.update(siteKey ? { captchaSiteKey: siteKey } : { notice: { code: 'captcha_required', fatal: true } });
            if (siteKey && this.store.get().open) {
                this.presentCaptcha(siteKey, referrer);
            }
            return;
        }

        if (FATAL_SESSION_CODES.includes(error.code) || error.code === 'captcha_invalid') {
            this.fatal(error.code);
            return;
        }

        const delay = error.code === 'rate_limited' && error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : this.nextRetryDelay();
        this.store.update({ notice: { code: error.transient ? error.code === 'rate_limited' ? 'rate_limited' : 'network' : 'unknown', vars: { seconds: Math.ceil(delay / 1000) }, fatal: false } });
        // Galat 4xx yang bukan sementara tak akan sembuh dengan mencoba terus — berhenti setelah beberapa kali.
        if (error.transient || this.startAttempts < MAX_START_ATTEMPTS) {
            retry(delay);
        }
    }


    private presentCaptcha(siteKey: string, referrer = ''): void {
        showCaptcha(this.env.window, this.view.captchaContainer, siteKey, (token) => {
            this.store.update({ captchaSiteKey: null });
            void this.start(referrer, token);
        }).catch(() => {
            this.store.update({ notice: { code: 'captcha_invalid', fatal: false } });
        });
    }


    private fatal(code: string): void {
        this.realtime.disconnect();
        this.tracker.setReady(false);
        this.proactive.stop();
        this.store.update({ notice: { code, fatal: true }, connection: 'idle' });
        this.env.host.event('error', { code });
    }


    /* ── ketersediaan (W5b) ── */

    /** Konfigurasi baru → status tim, jam kerja, estimasi balas; penyegaran berikutnya dijadwalkan. */
    private applyConfig(config: WidgetConfig): void {
        this.tracker.setEnabled(config.privacy?.page_tracking !== false);
        this.proactive.setRules(config.proactive?.rules ?? []);
        this.store.update({
            config,
            teamOnline: config.team?.online ?? null,
            hoursOpen: config.business_hours?.open ?? true,
            nextOpenAt: config.business_hours?.next_open_at ?? null,
            hoursTimezone: config.business_hours?.timezone ?? null,
            replyEstimateMinutes: config.availability?.reply_estimate_minutes ?? null,
        });
        this.scheduleConfigRefresh();
    }


    /**
     * Tiap 5 menit — atau tepat saat jam buka tiba (lebih cepat): status dibuka LOKAL dulu (respons konfigurasi boleh
     * ter-cache ≤ 60 dtk), lalu konfigurasi dibaca ulang. Gagal membaca = keadaan lama dipertahankan.
     */
    private scheduleConfigRefresh(): void {
        if (this.configTimer !== null) {
            clearTimeout(this.configTimer);
        }
        const nextOpenAt = this.store.get().nextOpenAt;
        const untilOpen = nextOpenAt ? Date.parse(nextOpenAt) - Date.now() : Number.POSITIVE_INFINITY;
        // Jam buka yang SUDAH lewat (jam server/perangkat beda, cache) bukan "segera buka" — dulu memicu siklus
        // baca ulang 2×/menit tanpa henti dan status berkedip.
        const opensSoon = Number.isFinite(untilOpen) && untilOpen > 0 && untilOpen < CONFIG_REFRESH_MS;
        const delay = opensSoon ? Math.max(untilOpen, 0) : CONFIG_REFRESH_MS;
        this.configTimer = setTimeout(() => {
            this.configTimer = null;
            if (opensSoon) {
                this.store.update({ hoursOpen: true, nextOpenAt: null });
            }
            void this.refreshConfig(opensSoon);
        }, delay);
    }


    private async refreshConfig(justOpened: boolean): Promise<void> {
        try {
            const config = await this.api.config(this.env.widgetId);
            // Tepat saat jam buka, salinan ter-cache bisa masih "tutup" — status lokal dipertahankan sampai salinan
            // baru tiba.
            if (justOpened && config.business_hours?.open === false) {
                this.store.update({ config, teamOnline: config.team?.online ?? this.store.get().teamOnline });
                this.configTimer = setTimeout(() => {
                    this.configTimer = null;
                    void this.refreshConfig(false);
                }, CONFIG_REFRESH_MIN_MS * 2);
                return;
            }
            this.applyConfig(config);
        } catch {
            this.scheduleConfigRefresh();
        }
    }


    /**
     * Formulir "tinggalkan pesan" (W5b): pesan + email → `POST /offline-messages`. Pesan tampil di percakapan seperti
     * pesan biasa; setelah itu pengunjung menulis lewat kotak tulis (alamat balasan sudah diketahui).
     */
    private async submitOffline(values: OfflineValues): Promise<void> {
        if (this.store.get().offlineBusy) {
            return;
        }
        this.store.update({ offlineBusy: true, offlineError: null });
        const clientMessageId = newMessageId(this.env.window);
        try {
            const result = await this.session.withToken((token) => this.api.offlineMessage(token, {
                client_message_id: clientMessageId,
                text: values.text,
                email: values.email,
                ...(values.name ? { name: values.name } : {}),
                page: this.page,
            }));
            const message: ChatMessage = {
                id: result.message_id,
                client_message_id: clientMessageId,
                direction: 'inbound',
                sender: { kind: 'customer', name: null },
                type: 'text',
                text: values.text,
                status: 'accepted',
                timestamp: new Date().toISOString(),
                local: true,
            };
            this.store.update((state) => ({
                messages: upsertMessages(state.messages, [message]),
                emailOnFile: true,
                offlineBusy: false,
                prechatPending: false,
                notice: state.notice?.fatal ? state.notice : null,
            }));
            this.tabs.post({ type: 'sent', message });
            this.view.offlineSubmitted();
            this.env.host.event('lead_captured', { source: 'offline_form' });
        } catch (error) {
            if (error instanceof ApiError && FATAL_SESSION_CODES.includes(error.code)) {
                this.store.update({ offlineBusy: false });
                this.fatal(error.code);
                return;
            }
            this.store.update({ offlineBusy: false, offlineError: error instanceof ApiError ? error.code : 'unknown' });
        }
    }


    /* ── kirim pesan ── */

    private send(text: string): void {
        const message: ChatMessage = {
            id: null,
            client_message_id: newMessageId(this.env.window),
            direction: 'inbound',
            sender: { kind: 'customer', name: null },
            type: 'text',
            text,
            status: 'pending',
            timestamp: new Date().toISOString(),
            local: true,
        };
        this.store.update((state) => ({ messages: upsertMessages(state.messages, [message]), teaser: null }));
        this.proactive.stop();
        void this.flushOutbox();
    }


    /**
     * Lampiran (W7a): diperiksa dulu terhadap pengaturan widget (jenis & ukuran — server memeriksa ulang, termasuk
     * ISI berkas), lalu masuk antrean seperti pesan biasa dengan pratinjau lokal.
     */
    private attach(file: File): void {
        const settings = this.store.get().config?.attachments;
        if (!settings?.enabled) {
            this.store.update({ notice: { code: 'attachments_disabled', fatal: false } });
            return;
        }
        if (!settings.mime_allow.includes(file.type)) {
            this.store.update({ notice: { code: 'attachment_not_allowed', fatal: false } });
            return;
        }
        if (file.size <= 0 || file.size > settings.max_mb * 1024 * 1024) {
            this.store.update({ notice: { code: 'attachment_too_large', vars: { mb: settings.max_mb }, fatal: false } });
            return;
        }
        const clientMessageId = newMessageId(this.env.window);
        const image = file.type.startsWith('image/');
        const preview = image && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
        this.uploads.set(clientMessageId, { file, attachmentId: null });
        const message: ChatMessage = {
            id: null,
            client_message_id: clientMessageId,
            direction: 'inbound',
            sender: { kind: 'customer', name: null },
            type: image ? 'image' : 'document',
            text: null,
            status: 'pending',
            timestamp: new Date().toISOString(),
            local: true,
            attachment: { type: image ? 'image' : 'document', url: preview, mime_type: file.type, filename: file.name, size: file.size, expires_at: null },
        };
        this.store.update((state) => ({ messages: upsertMessages(state.messages, [message]) }));
        void this.flushOutbox();
    }


    /**
     * Klik pilihan pada pesan tim (W7b): tampil seketika sebagai pesan pengunjung berjudul pilihan, dikirim sebagai
     * `postback` (server memverifikasinya terhadap pesan asal). Tautan tak lewat sini — dibuka langsung oleh tampilan.
     */
    private choose(messageId: string, item: { id: string; title: string }): void {
        const clientMessageId = newMessageId(this.env.window);
        this.postbacks.set(clientMessageId, { message_id: messageId, id: item.id });
        const message: ChatMessage = {
            id: null,
            client_message_id: clientMessageId,
            direction: 'inbound',
            sender: { kind: 'customer', name: null },
            type: 'text',
            text: item.title,
            status: 'pending',
            timestamp: new Date().toISOString(),
            local: true,
        };
        this.store.update((state) => ({ messages: upsertMessages(state.messages, [message]) }));
        void this.flushOutbox();
    }


    /** Unggah berkas pesan ke penyimpanan (sekali per `attachment_id`) → id untuk `POST /messages`. */
    private async uploadedAttachmentId(clientMessageId: string): Promise<string | null> {
        const pending = this.uploads.get(clientMessageId);
        if (!pending) {
            return null;
        }
        if (pending.attachmentId) {
            return pending.attachmentId;
        }
        const file = pending.file instanceof File ? pending.file : null;
        const presigned = await this.session.withToken((token) => this.api.presignAttachment(token, {
            filename: file?.name ?? 'lampiran',
            mime: pending.file.type,
            size: pending.file.size,
        }));
        await this.api.upload(presigned.upload, pending.file);
        pending.attachmentId = presigned.attachment_id;
        return presigned.attachment_id;
    }


    private retry(clientMessageId: string): void {
        this.store.update((state) => ({
            messages: state.messages.map((message) => message.client_message_id === clientMessageId && message.status === 'failed'
                ? { ...message, status: 'pending' }
                : message),
        }));
        void this.flushOutbox();
    }


    /** Kirim antrean berurutan. Idempoten di server (`client_message_id`) — kirim ulang tak menggandakan pesan. */
    private async flushOutbox(): Promise<void> {
        if (this.sending || !this.session.current) {
            return;
        }
        this.sending = true;
        try {
            for (;;) {
                const next = this.store.get().messages.find((message) => message.direction === 'inbound' && message.status === 'pending');
                if (!next?.client_message_id || (!next.text && !this.uploads.has(next.client_message_id))) {
                    return;
                }
                if (!(await this.sendOne(next))) {
                    return;
                }
            }
        } finally {
            this.sending = false;
        }
    }


    private async sendOne(message: ChatMessage): Promise<boolean> {
        const clientMessageId = message.client_message_id ?? '';
        const generation = this.generation;
        try {
            const attachmentId = await this.uploadedAttachmentId(clientMessageId);
            const postback = this.postbacks.get(clientMessageId);
            const result = await this.session.withToken((token) => this.api.send(token, {
                client_message_id: clientMessageId,
                ...(postback ? { postback } : message.text ? { text: message.text } : {}),
                ...(attachmentId ? { attachment_ids: [attachmentId] } : {}),
                page: this.page,
            }));
            if (generation !== this.generation) {
                return false;
            }
            this.uploads.delete(clientMessageId);
            this.postbacks.delete(clientMessageId);
            const accepted: ChatMessage = { ...message, id: result.message_id, status: 'accepted' };
            this.store.update((state) => ({
                messages: upsertMessages(state.messages, [accepted]),
                notice: state.notice?.fatal ? state.notice : null,
                // Kiriman berhasil = jaringan pulih (dulu banner "offline" menetap sampai socket tersambung ulang).
                connection: state.connection === 'offline' && this.realtime.connected ? 'online' : state.connection,
            }));
            this.tabs.post({ type: 'sent', message: accepted });
            this.retryAttempt = 0;
            return true;
        } catch (error) {
            return generation === this.generation ? this.onSendError(clientMessageId, error) : false;
        }
    }


    /** @returns true bila antrean boleh lanjut ke pesan berikutnya. */
    private onSendError(clientMessageId: string, error: unknown): boolean {
        // Lampiran gagal: kirim ulang mengunggah dari awal (URL & id unggahan lama tak dipakai lagi).
        const upload = this.uploads.get(clientMessageId);
        if (upload) {
            upload.attachmentId = null;
        }
        if (error instanceof ApiError && ATTACHMENT_ERROR_CODES.includes(error.code)) {
            const mb = this.store.get().config?.attachments?.max_mb ?? 10;
            this.store.update((state) => ({
                messages: state.messages.map((message) => message.client_message_id === clientMessageId ? { ...message, status: 'failed' } : message),
                notice: { code: error.code, vars: { mb }, fatal: false },
            }));
            return true;
        }
        if (error instanceof ApiError && error.transient) {
            const delay = error.code === 'rate_limited' && error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : this.nextRetryDelay();
            // Batas laju & plafon percakapan baru (429) ditampilkan; galat jaringan/server cukup indikator koneksi.
            const shown = error.code === 'rate_limited' || error.code === 'conversation_limit_reached';
            const seconds = Math.ceil(delay / 1000);
            const notice = shown ? { code: error.code, vars: { seconds }, fatal: false } : null;
            const connection = error.code === 'network' ? 'offline' : this.store.get().connection;
            this.store.update({ notice, connection });
            this.scheduleRetry(delay);
            return false;
        }

        this.store.update((state) => ({
            messages: state.messages.map((message) => message.client_message_id === clientMessageId ? { ...message, status: 'failed' } : message),
        }));
        if (error instanceof ApiError && FATAL_SESSION_CODES.includes(error.code)) {
            this.fatal(error.code);
            return false;
        }
        if (error instanceof ApiError && (error.code === 'conversation_limit_reached' || error.code === 'identity_required')) {
            this.store.update({ notice: { code: error.code, fatal: false } });
        }
        if (error instanceof ApiError && error.code === 'prechat_required') {
            this.store.update({ notice: { code: error.code, fatal: false }, prechatPending: true });
        }
        return true;
    }


    private nextRetryDelay(): number {
        const delay = RETRY_STEPS_MS[Math.min(this.retryAttempt, RETRY_STEPS_MS.length - 1)] ?? 30000;
        this.retryAttempt += 1;
        return delay;
    }


    private scheduleRetry(delayMs: number): void {
        if (this.retryTimer !== null) {
            return;
        }
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.flushOutbox();
        }, delayMs);
    }


    /* ── realtime ── */

    private onServerEvent<K extends keyof ServerEvents>(name: K, payload: Payload<K>): void {
        switch (name) {
            case 'message.created':
                this.onTeamMessage(payload as Payload<'message.created'>);
                break;
            case 'message.status':
                this.onStatus(payload as Payload<'message.status'>);
                break;
            case 'typing': {
                const typing = payload as Payload<'typing'>;
                this.showTeamTyping(typing.typing && typing.expires_at ? Date.parse(typing.expires_at) : 0);
                break;
            }
            case 'session.refresh_required':
                void this.refreshAndReconnect();
                break;
            case 'session.revoked':
                this.session.clear();
                // Kode "Lanjutkan di WhatsApp" terpakai (W8d/W10b): percakapan pindah ke WhatsApp, sesi ini diakhiri.
                this.fatal((payload as Payload<'session.revoked'>).reason === 'continued_on_whatsapp' ? 'continued_on_whatsapp' : 'session_revoked');
                break;
            case 'team.presence':
                this.store.update({ teamOnline: (payload as Payload<'team.presence'>).online });
                break;
            case 'conversation.state':
                this.store.update({ conversationStatus: (payload as Payload<'conversation.state'>).status });
                break;
            case 'conversation.handoff':
                this.store.update({ handoffActive: (payload as Payload<'conversation.handoff'>).active });
                break;
            case 'proactive.message':
                this.showProactive((payload as Payload<'proactive.message'>).message);
                break;
            case 'whatsapp.linked':
                this.store.update({ whatsappLinked: (payload as Payload<'whatsapp.linked'>).phone_masked ?? '' });
                break;
            case 'csat.updated':
                this.store.update({ survey: (payload as Payload<'csat.updated'>).survey, surveyError: null });
                break;
        }
    }


    private onTeamMessage(payload: Payload<'message.created'>): void {
        const message = payload.message;
        const known = this.store.get().messages.some((existing) => existing.id !== null && existing.id === message.id);
        this.store.update((state) => ({
            messages: upsertMessages(state.messages, [message]),
            conversationId: state.conversationId ?? payload.conversation_id,
            agentTypingUntil: 0,
        }));
        if (known || message.direction !== 'outbound') {
            return;
        }
        this.realtime.emitSpaced('delivered', { up_to: message.timestamp });
        if (this.isReading()) {
            this.markRead();
            return;
        }
        this.store.update((state) => ({ unread: state.unread + 1 }));
        if (this.store.get().soundEnabled) {
            this.sound.play();
        }
        this.env.host.event('message', { sender: message.sender, text: message.text, timestamp: message.timestamp });
    }


    /* ── lanjutkan di WhatsApp (W8d) ── */

    /** Tautan `wa.me` berkode disiapkan saat jendela dibuka (sekali per sesi); gagal = tombol tak tampil. */
    private async prepareWhatsApp(): Promise<void> {
        const state = this.store.get();
        if (!state.config?.whatsapp?.enabled || state.whatsappUrl || this.whatsappPending || !this.session.current) {
            return;
        }
        this.whatsappPending = true;
        try {
            const link = await this.session.withToken((token) => this.api.whatsappLink(token));
            this.store.update({ whatsappUrl: link.url });
        } catch {
            // Tombol tak tampil; chat tetap berjalan.
        } finally {
            this.whatsappPending = false;
        }
    }


    /* ── pesan proaktif (W8b) ── */

    /** Pemicu terpenuhi → minta server. `true` = tampil (mesin berhenti). Yang sudah bercakap tak meminta. */
    private async claimProactive(ruleId: string): Promise<boolean> {
        if (this.store.get().conversationId || !this.session.current) {
            return false;
        }
        const page = { url: this.page.url.slice(0, 2000), title: this.page.title.slice(0, 300) };
        const result = await this.session.withToken((token) => this.api.claimProactive(token, ruleId, page));
        if (!result.shown || !result.message) {
            return false;
        }
        this.showProactive(result.message);
        return true;
    }


    /**
     * Tampilkan pesan proaktif: masuk daftar pesan (id = id pesan di percakapan nanti → tak tampil ganda saat riwayat
     * server memuatnya) dan, bila jendela tertutup, sebagai kartu di atas launcher + lencana belum dibaca.
     */
    private showProactive(proactive: ProactiveMessage): void {
        const message: ChatMessage = {
            id: proactive.id,
            client_message_id: null,
            direction: 'outbound',
            sender: { kind: proactive.sender.kind, name: proactive.sender.name },
            type: 'text',
            text: proactive.text,
            status: 'read',
            timestamp: proactive.at ?? new Date().toISOString(),
        };
        const open = this.store.get().open;
        this.store.update((state) => ({
            messages: upsertMessages(state.messages, [message]),
            ...(open ? {} : { teaser: proactive, unread: state.unread + 1 }),
        }));
        this.proactive.stop();
        if (!open && this.store.get().soundEnabled) {
            this.sound.play();
        }
        this.env.host.event('message', { sender: message.sender, text: message.text, timestamp: message.timestamp });
    }


    private async syncHistory(): Promise<void> {
        const generation = this.generation;
        const history = await this.session.withToken((token) => this.api.conversation(token));
        if (generation !== this.generation) {
            return;
        }
        this.countMissedReplies(history.messages);
        this.store.update((state) => ({
            messages: upsertMessages(state.messages, history.messages),
            conversationId: history.conversation?.id ?? state.conversationId,
            conversationStatus: history.conversation?.status ?? 'open',
            survey: history.survey === undefined ? state.survey : history.survey,
            handoffActive: history.conversation?.handoff?.active ?? state.handoffActive,
        }));
    }


    /* ── penilaian & transkrip (W5c) ── */

    /** Skor (tombol kartu) atau komentar → `POST /csat`; keadaan kartu diganti jawaban server. */
    private async submitSurvey(body: { score?: number; comment?: string }): Promise<void> {
        if (this.store.get().surveyBusy) {
            return;
        }
        this.store.update({ surveyBusy: true, surveyError: null });
        try {
            const result = await this.session.withToken((token) => this.api.submitCsat(token, body));
            this.store.update({ survey: result.survey, surveyBusy: false });
        } catch (error) {
            this.store.update({ surveyBusy: false, surveyError: error instanceof ApiError ? error.code : 'unknown' });
            if (error instanceof ApiError && FATAL_SESSION_CODES.includes(error.code)) {
                this.fatal(error.code);
            }
        }
    }


    /* ── bicara dengan tim (W6c) ── */

    private async requestHandoff(): Promise<void> {
        const state = this.store.get();
        if (state.handoffBusy || state.handoffActive) {
            return;
        }
        this.store.update({ handoffBusy: true });
        try {
            const result = await this.session.withToken((token) => this.api.requestHandoff(token));
            // Pesan sistem ("kami teruskan ke tim") datang lewat socket `message.created` seperti balasan biasa.
            this.store.update({ handoffBusy: false, handoffActive: result.handoff.active });
        } catch (error) {
            const code = error instanceof ApiError ? error.code : 'unknown';
            const seconds = error instanceof ApiError ? error.retryAfterSeconds : null;
            const notice = { code, fatal: false, ...(seconds ? { vars: { seconds } } : {}) };
            this.store.update({ handoffBusy: false, notice });
            if (error instanceof ApiError && FATAL_SESSION_CODES.includes(error.code)) {
                this.fatal(error.code);
            }
        }
    }


    private async sendTranscript(email: string | null): Promise<void> {
        const panel = this.store.get().transcript;
        if (!panel || panel.busy) {
            return;
        }
        this.store.update({ transcript: { ...panel, busy: true, error: null } });
        try {
            await this.session.withToken((token) => this.api.requestTranscript(token, email ? { email } : {}));
            this.store.update({ transcript: { busy: false, sent: true, error: null }, emailOnFile: true });
        } catch (error) {
            const code = error instanceof ApiError ? error.code : 'unknown';
            this.store.update((state) => (state.transcript
                ? { transcript: { ...state.transcript, busy: false, error: code } }
                : {}));
            if (error instanceof ApiError && FATAL_SESSION_CODES.includes(error.code)) {
                this.fatal(error.code);
            }
        }
    }


    private onStatus(payload: Payload<'message.status'>): void {
        const unknown = payload.direction === 'inbound' && payload.message_id !== null
            && !this.store.get().messages.some((message) => message.id === payload.message_id
                || (payload.client_message_id !== null && message.client_message_id === payload.client_message_id));
        if (unknown) {
            // Pesan tab ini yang tersimpan SETELAH halaman dimuat (dikirim sebelum muat ulang) — susulkan riwayatnya.
            void this.syncHistory().catch(() => undefined);
        }
        if (payload.direction === 'inbound') {
            this.store.update((state) => ({
                messages: applyInboundStatus(state.messages, {
                    messageId: payload.message_id,
                    clientMessageId: payload.client_message_id,
                    status: payload.status,
                    upToAt: payload.up_to_at,
                }),
            }));
        }
        if (payload.conversation_id && !this.store.get().conversationId) {
            this.store.update({ conversationId: payload.conversation_id });
        }
    }


    /**
     * Balasan tim yang baru diketahui lewat sinkron (sambung ulang, muat ulang) dan belum dibaca → lencana belum
     * dibaca;
     * dulu hanya pesan socket yang dihitung.
     */
    private countMissedReplies(incoming: readonly ChatMessage[]): void {
        const known = new Set(this.store.get().messages.map((message) => message.id).filter((id) => id !== null));
        const missed = incoming.filter((message) => message.direction === 'outbound' && message.id !== null
            && !known.has(message.id) && message.status !== 'read').length;
        if (!missed) {
            return;
        }
        if (this.isReading()) {
            this.markRead();
            return;
        }
        this.store.update((state) => ({ unread: state.unread + missed }));
    }


    private showTeamTyping(until: number): void {
        this.store.update({ agentTypingUntil: until });
        if (this.typingRenderTimer !== null) {
            clearTimeout(this.typingRenderTimer);
        }
        if (until > Date.now()) {
            // Indikator padam sendiri bila sinyal berhenti datang.
            this.typingRenderTimer = setTimeout(() => {
                this.store.update({ agentTypingUntil: 0 });
            }, until - Date.now());
        }
    }


    /**
     * Setiap kali tersambung (pertama kali maupun ulang), celah antara pengambilan riwayat dan berlangganan socket
     * diisi: pesan yang tersimpan di celah itu (mis. dikirim tepat sebelum halaman dimuat ulang) tak pernah sampai
     * lewat socket. Setelah tersambung, event status menyusulkan sisanya.
     */
    private async onConnected(reconnected: boolean): Promise<void> {
        this.store.update({ connection: 'online' });
        const after = lastServerTimestamp(this.store.get().messages);
        try {
            if (reconnected && after) {
                const generation = this.generation;
                // 1 ms sebelum pesan terakhir: kursor server `after` ketat, pesan berwaktu SAMA tak terlewati
                // (duplikat dibuang per id oleh `upsertMessages`).
                const since = new Date(Date.parse(after) - 1).toISOString();
                const page = await this.session.withToken((token) => this.api.messagesAfter(token, since));
                if (generation !== this.generation) {
                    return;
                }
                this.countMissedReplies(page.messages);
                this.store.update((state) => ({ messages: upsertMessages(state.messages, page.messages) }));
            } else {
                await this.syncHistory();
            }
        } catch {
            // Riwayat tersusul pada sambungan atau event status berikutnya.
        }
        void this.flushOutbox();
        if (this.isReading()) {
            this.markRead();
        }
    }


    private async refreshAndReconnect(): Promise<void> {
        try {
            await this.session.refresh(true);
            this.realtime.reconnect();
        } catch (error) {
            if (error instanceof ApiError && !error.transient) {
                this.fatal(FATAL_SESSION_CODES.includes(error.code) ? error.code : 'session_revoked');
            } else {
                setTimeout(() => {
                    void this.refreshAndReconnect();
                }, this.nextRetryDelay());
            }
        }
    }


    /* ── buka / tutup, dibaca, mengetik ── */

    private setOpen(open: boolean): void {
        const state = this.store.get();
        if (state.open === open) {
            return;
        }
        this.store.update(open ? { open, teaser: null } : { open });
        this.env.host.event(open ? 'open' : 'close');
        if (open) {
            this.tracker.widgetOpened();
            void this.prepareWhatsApp();
        }
        if (!open) {
            return;
        }
        if (state.captchaSiteKey) {
            this.presentCaptcha(state.captchaSiteKey);
        }
        this.markRead();
        this.env.window.setTimeout(() => {
            this.view.focusInput();
        }, 0);
    }


    private isReading(): boolean {
        const state = this.store.get();
        return state.open && state.visible;
    }


    private markRead(): void {
        const hasReplies = this.store.get().messages.some((message) => message.direction === 'outbound');
        if (this.store.get().unread !== 0) {
            this.store.update({ unread: 0 });
            this.tabs.post({ type: 'read' });
        }
        if (!hasReplies || !this.session.current) {
            return;
        }
        if (this.realtime.connected) {
            this.realtime.emitSpaced('read', {});
        } else {
            void this.session.withToken((token) => this.api.markRead(token)).catch(() => undefined);
        }
    }


    private visitorTyping(): void {
        const now = Date.now();
        if (now - this.lastTypingSentAt > TYPING_THROTTLE_MS) {
            this.lastTypingSentAt = now;
            this.realtime.emit('typing', { typing: true });
        }
        if (this.typingIdleTimer !== null) {
            clearTimeout(this.typingIdleTimer);
        }
        this.typingIdleTimer = setTimeout(() => {
            this.lastTypingSentAt = 0;
            this.realtime.emit('typing', { typing: false });
        }, TYPING_IDLE_MS);
    }


    private toggleSound(): void {
        const enabled = !this.store.get().soundEnabled;
        this.storage.set(this.keys.sound, enabled ? 'on' : 'off');
        this.store.update({ soundEnabled: enabled });
    }


    /* ── tab lain & shutdown ── */

    private onTabMessage(message: Parameters<Parameters<TabChannel['onMessage']>[0]>[0]): void {
        if (message.type === 'sent') {
            this.store.update((state) => ({ messages: upsertMessages(state.messages, [message.message]) }));
        } else if (message.type === 'read') {
            this.store.update({ unread: 0 });
        } else if (message.type === 'shutdown') {
            // Tab lain logout: sesi tab itu sudah dicabut & storage sudah dibersihkannya — tab ini TIDAK menghapus
            // storage (bisa menghapus refresh token BARU tab itu), cukup melepas sesi di memori lalu memulai lagi
            // (sesi baru tab asal dipakai bersama). Dulu tab ini menjadi "zombi": pesan menggantung "mengirim".
            this.endVisitor();
            this.session.forget();
            const generation = this.generation;
            setTimeout(() => {
                if (generation === this.generation) {
                    void this.start(this.referrer);
                }
            }, TAB_RESTART_DELAY_MS);
        }
    }


    /** Formulir pre-chat tampil: widget memintanya, belum dikirim, pengunjung belum terverifikasi, tak dilewati. */
    private needsPrechat(session: Session): boolean {
        const mode = this.store.get().config?.prechat?.mode ?? 'off';
        if (mode === 'off' || session.prechat_completed === true || session.trust_level === 'verified') {
            return false;
        }
        return !(mode === 'optional' && this.storage.get(this.keys.prechatSkipped) === session.visitor_id);
    }


    private async submitPrechat(values: PrechatValues): Promise<void> {
        if (this.store.get().prechatBusy) {
            return;
        }
        this.store.update({ prechatBusy: true, prechatError: null });
        const consentVersion = this.store.get().config?.privacy?.consent_version ?? null;
        const body = { fields: values, ...(consentVersion ? { consent_version: consentVersion } : {}) };
        try {
            const result = await this.session.withToken((token) => this.api.prechat(token, body));
            // Email di formulir pre-chat = alamat balasan (server mencatatnya) — formulir offline tak bertanya lagi.
            const emailField = this.store.get().config?.prechat?.fields.find((field) => field.type === 'email');
            const gaveEmail = emailField !== undefined && typeof values[emailField.key] === 'string';
            this.store.update((state) => ({
                prechatPending: false,
                prechatBusy: false,
                trustLevel: result.trust_level,
                notice: null,
                emailOnFile: state.emailOnFile || gaveEmail,
            }));
            this.env.host.event('lead_captured', { source: 'prechat' });
            this.view.focusInput();
        } catch (error) {
            this.store.update({ prechatBusy: false, prechatError: error instanceof ApiError ? error.code : 'unknown' });
            if (error instanceof ApiError && FATAL_SESSION_CODES.includes(error.code)) {
                this.fatal(error.code);
            }
        }
    }


    private updateOtp(patch: Partial<NonNullable<AppState['otp']>>): void {
        this.store.update((state) => (state.otp ? { otp: { ...state.otp, ...patch } } : {}));
    }


    /** Kode verifikasi ke email (W4c). */
    private async requestOtp(email: string): Promise<void> {
        this.updateOtp({ busy: true, error: null, email });
        try {
            await this.session.withToken((token) => this.api.requestOtp(token, email));
            this.updateOtp({ busy: false, step: 'code' });
        } catch (error) {
            this.updateOtp({ busy: false, error: otpErrorOf(error) });
        }
    }


    /** Kode benar → pengunjung terverifikasi; riwayat & socket dimuat ulang dengan hak baru. */
    private async verifyOtp(code: string): Promise<void> {
        const email = this.store.get().otp?.email ?? '';
        this.updateOtp({ busy: true, error: null });
        try {
            const session = await this.session.verifyOtp(email, code);
            this.store.update({
                otp: null, trustLevel: session.trust_level, prechatPending: false, notice: null, emailOnFile: true,
            });
            this.env.host.event('lead_captured', { source: 'otp_email' });
            await this.syncHistory();
            this.realtime.reconnect();
            this.view.focusInput();
        } catch (error) {
            if (error instanceof ApiError && FATAL_SESSION_CODES.includes(error.code)) {
                this.fatal(error.code);
                return;
            }
            this.updateOtp({ busy: false, error: otpErrorOf(error) });
        }
    }


    /** Mode `optional`: dilewati untuk pengunjung ini (diingat di storage iframe, tak ditanya lagi saat muat ulang). */
    private skipPrechat(): void {
        const visitorId = this.session.current?.visitor_id;
        if (visitorId) {
            this.storage.set(this.keys.prechatSkipped, visitorId);
        }
        this.store.update({ prechatPending: false });
        this.view.focusInput();
    }


    /**
     * Pengunjung terverifikasi (W4a): identity token dari server website → sesi `verified`. Token milik pengguna LAIN
     * dari yang sudah terverifikasi di sesi ini (`identity_mismatch`, mis. ganti akun tanpa logout) → sesi lama
     * diakhiri, sesi baru dimulai lalu diverifikasi dengan token itu — riwayat pengguna sebelumnya tak terbawa.
     */
    private async applyIdentity(retried = false): Promise<void> {
        const identityToken = this.pendingIdentity;
        if (identityToken === null || this.identifying || !this.session.current) {
            return;
        }
        this.identifying = true;
        this.pendingIdentity = null;
        try {
            const session = await this.session.identify(identityToken);
            const conversationId = session.conversation?.id ?? this.store.get().conversationId;
            // Pelanggan terverifikasi tak perlu memperkenalkan diri lagi.
            this.store.update((state) => ({
                trustLevel: session.trust_level,
                conversationId,
                prechatPending: false,
                emailOnFile: state.emailOnFile || session.email_on_file === true,
            }));
            await this.syncHistory();
            this.realtime.reconnect();
        } catch (error) {
            this.onIdentifyError(error, identityToken, retried);
        } finally {
            this.identifying = false;
        }
        // `identify` baru datang selama permintaan berjalan (mis. ganti akun cepat) → diterapkan berikutnya.
        if (this.hasPendingIdentity()) {
            void this.applyIdentity();
        } else if (this.pendingSignOut) {
            void this.applySignOut();
        }
    }


    /**
     * Website menyatakan tak ada yang login (logout di halaman server-rendered: sesi di iframe masih tersimpan). Sesi
     * yang terverifikasi LEWAT LOGIN WEBSITE diakhiri lalu diganti sesi anonim baru — pelanggan berikutnya di perangkat
     * bersama tak melihat chat orang sebelumnya. Sesi anonim & verifikasi kode email tak terkait login → dibiarkan.
     */
    private async applySignOut(): Promise<void> {
        if (!this.pendingSignOut || this.identifying || !this.session.current) {
            return;
        }
        this.pendingSignOut = false;
        if (this.session.current.verification_method !== 'identity_token') {
            return;
        }
        await this.shutdown();
        await this.start();
    }


    private hasPendingIdentity(): boolean {
        return this.pendingIdentity !== null;
    }


    private onIdentifyError(error: unknown, identityToken: string, retried: boolean): void {
        if (error instanceof ApiError && error.code === 'identity_mismatch' && !retried) {
            void this.restartAs(identityToken);
            return;
        }
        if (error instanceof ApiError && FATAL_SESSION_CODES.includes(error.code)) {
            this.fatal(error.code);
            return;
        }
        const code = error instanceof ApiError ? error.code : 'unknown';
        const reason = error instanceof ApiError ? error.details?.['reason'] ?? null : null;
        this.env.host.event('error', { code, reason });
    }


    private async restartAs(identityToken: string): Promise<void> {
        await this.shutdown();
        await this.start();
        this.pendingIdentity = identityToken;
        await this.applyIdentity(true);
    }


    private async shutdown(): Promise<void> {
        // Jejak yang tertunda milik pengunjung yang keluar — dikirim dulu, lalu pelacak berhenti sampai sesi baru.
        this.tracker.flushNow(false);
        this.endVisitor();
        await this.session.shutdown();
    }


    /**
     * Sesi pengunjung ini berakhir: SEMUA keadaan miliknya dikosongkan — termasuk tautan "Lanjutkan di WhatsApp"
     * berkode miliknya (dulu tertinggal, sehingga orang berikutnya di perangkat bersama mengirim kode orang
     * sebelumnya), panel OTP, dan kartu proaktif — dan hasil async yang masih berjalan dibuang (`generation`).
     */
    private endVisitor(): void {
        this.generation += 1;
        this.watchConversation = false;
        this.realtime.disconnect();
        this.tracker.setReady(false);
        this.proactive.reset();
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        this.uploads.clear();
        this.postbacks.clear();
        this.whatsappPending = false;
        this.store.update({ ...VISITOR_STATE_RESET, open: this.standalone });
    }


    /* ── tampilan & laporan ke loader ── */

    /**
     * Mode offline `hidden` (W5b): saat tim tak `open`, launcher disembunyikan bagi pengunjung yang BELUM punya
     * percakapan; yang sedang bercakap tetap melihatnya (balasan tim tetap sampai).
     */
    private hiddenWhileOffline(state: AppState): boolean {
        return state.config?.offline?.mode === 'hidden' && Boolean(state.config.availability)
            && availabilityOf(state) !== 'open' && state.conversationId === null && state.messages.length === 0;
    }


    private render(state: AppState): void {
        const stopped = state.notice?.fatal === true && !state.open;
        // Launcher disembunyikan oleh website (opsi `hideLauncher`) ATAU pengaturan tenant di dashboard
        // (`appearance.hide_launcher`) — chat dibuka lewat tombol website sendiri (`Plasgos("open")`).
        const hiddenBySettings = state.config?.appearance.hide_launcher === true;
        const launcherHidden = this.hideLauncher || hiddenBySettings || state.config === null || stopped
            || this.hiddenWhileOffline(state);
        const teaser = state.teaser !== null;
        const layout = frameLayout(state.open, state.config?.appearance ?? {}, this.viewport, launcherHidden, teaser);
        this.view.render(state, { fullscreen: this.viewport.width < MOBILE_BREAKPOINT, hideLauncher: layout.state === 'hidden' });
        const layoutKey = JSON.stringify(layout);
        if (layoutKey !== this.lastLayout) {
            this.lastLayout = layoutKey;
            this.env.host.frame(layout);
        }
        const published = {
            booted: this.session.current !== null,
            open: state.open,
            unread: state.unread,
            trustLevel: state.trustLevel,
        };
        const publishedKey = JSON.stringify(published);
        if (publishedKey !== this.lastPublished) {
            const previousUnread = this.lastUnread;
            this.lastUnread = state.unread;
            this.lastPublished = publishedKey;
            this.env.host.state(published);
            if (previousUnread !== state.unread) {
                this.env.host.event('unread_changed', { count: state.unread });
            }
        }
    }
}

/** Web Locks (Safari < 15.4 belum punya — tipe lib DOM menganggapnya selalu ada). */
interface Locks {
    request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

function lockManagerOf(navigator: Navigator): Locks | null {
    const locks: unknown = Reflect.get(navigator, 'locks');
    if (typeof locks !== 'object' || locks === null || typeof Reflect.get(locks, 'request') !== 'function') {
        return null;
    }
    const manager = locks as LockManager;
    return { request: (name, callback) => manager.request(name, callback) };
}

/** `Plasgos('consent', { analytics })` (bentuk resmi) atau `Plasgos('consent', true|false)`; lainnya diabaikan. */
function consentOf(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)['analytics'] === 'boolean') {
        return (value as Record<string, boolean>)['analytics'] ?? null;
    }
    return null;
}

function pageOf(value: unknown): PageInfo | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const record = value as Record<string, unknown>;
    return typeof record['url'] === 'string' ? { url: record['url'], title: typeof record['title'] === 'string' ? record['title'] : '' } : null;
}


/**
 * `client_message_id` (UUID v4). Safari < 15.4 belum punya `crypto.randomUUID` — dulu `send()` melempar SETELAH kotak
 * tulis dikosongkan sehingga teks pengunjung hilang.
 */
function newMessageId(win: Window): string {
    const crypto = win.crypto as Crypto & { randomUUID?: () => string };
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
