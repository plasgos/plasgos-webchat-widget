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
import { applyInboundStatus, INITIAL_STATE, lastServerTimestamp, Store, upsertMessages } from './store';
import type { AppState } from './store';
import { createTabChannel } from './tabs';
import type { TabChannel } from './tabs';
import type { ChatMessage, Locale, PageInfo, Session } from './types';
import type { PrechatValues } from './ui/prechat';
import { ChatView } from './ui/view';

/** Jeda coba ulang antrean kirim saat jaringan/server bermasalah. */
const RETRY_STEPS_MS = [2000, 5000, 10000, 30000];
const TYPING_THROTTLE_MS = 2500;
const TYPING_IDLE_MS = 3000;

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
/** Argumen perintah `identify`: `{ token }` (bentuk resmi) atau string token. */
function identityTokenOf(value: unknown): string | null {
    const token: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'token') : value;
    return typeof token === 'string' && token.length > 0 && token.length <= 8192 ? token : null;
}


export class WidgetApp {
    private readonly store = new Store(INITIAL_STATE);

    private readonly api: PublicApi;

    private readonly storage: KeyValueStore;

    private readonly tabs: TabChannel;

    private readonly session: SessionManager;

    private readonly realtime: Realtime;

    private readonly view: ChatView;

    private readonly sound: NotificationSound;

    private readonly keys: ReturnType<typeof storageKeys>;

    private page: PageInfo;

    private hostOrigin: string;

    private hideLauncher = false;

    /** Identity token dari website yang menunggu sesi siap (perintah `identify` sebelum/di tengah boot). */
    private pendingIdentity: string | null = null;

    private identifying = false;

    private viewport: Viewport = { width: 1280, height: 800 };

    private started = false;

    private sending = false;

    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    private retryAttempt = 0;

    private typingIdleTimer: ReturnType<typeof setTimeout> | null = null;

    private typingRenderTimer: ReturnType<typeof setTimeout> | null = null;

    private lastTypingSentAt = 0;

    private lastLayout = '';

    private lastPublished = '';

    private preferredLocale: Locale | undefined;

    private lastUnread = 0;


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
        });
        this.view.mount(env.container);
        this.store.subscribe((state) => {
            this.render(state);
        });
        this.tabs.onMessage((message) => {
            this.onTabMessage(message);
        });
        env.document.addEventListener('visibilitychange', () => {
            this.store.update({ visible: env.document.visibilityState === 'visible' });
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
        this.page = { url: payload.page.url, title: payload.page.title };
        this.hostOrigin = payload.hostOrigin;
        this.hideLauncher = payload.options.hideLauncher === true;
        this.store.update({
            locale: payload.options.locale ?? 'id',
            soundEnabled: this.storage.get(this.keys.sound) !== 'off',
            visible: this.env.document.visibilityState === 'visible',
        });
        this.preferredLocale = payload.options.locale;
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
                void this.shutdown();
                break;
            case 'page':
                this.page = pageOf(first) ?? this.page;
                break;
            case 'setLocale':
                if (first === 'id' || first === 'en') {
                    this.store.update({ locale: first });
                }
                break;
            case 'identify':
                this.pendingIdentity = identityTokenOf(first);
                void this.applyIdentity();
                break;
            case 'track':
            case 'consent':
                break;
        }
    }


    public setViewport(viewport: Viewport): void {
        this.viewport = viewport;
        this.render(this.store.get());
    }


    /** Mode mandiri (dokumen dibuka langsung, bukan dalam iframe website): jendela langsung terbuka. */
    public openStandalone(): void {
        this.setOpen(true);
    }


    private async start(referrer = '', captchaToken: string | null = null): Promise<void> {
        try {
            if (!this.store.get().config) {
                const config = await this.api.config(this.env.widgetId);
                this.store.update({ config, locale: resolveLocale(this.preferredLocale, config.appearance.locale_default ?? 'id') });
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
            this.store.update({
                trustLevel: session.trust_level,
                conversationId: session.conversation?.id ?? null,
                captchaSiteKey: null,
                notice: null,
                connection: 'connecting',
                prechatPending: this.needsPrechat(session),
            });
            // Selalu dari catatan pengunjung di server — `session.conversation` masih null bila pesan terakhir baru
            // diterima (antre) saat halaman dimuat ulang.
            await this.syncHistory();
            this.realtime.connect();
            this.env.host.event('ready');
            await this.applyIdentity();
        } catch (error) {
            this.onStartError(error, referrer);
        }
    }


    private onStartError(error: unknown, referrer: string): void {
        if (!(error instanceof ApiError)) {
            this.store.update({ notice: { code: 'unknown', fatal: false } });
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
        setTimeout(() => {
            void this.start(referrer);
        }, delay);
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
        this.store.update({ notice: { code, fatal: true }, connection: 'idle' });
        this.env.host.event('error', { code });
    }


    /* ── kirim pesan ── */

    private send(text: string): void {
        const message: ChatMessage = {
            id: null,
            client_message_id: this.env.window.crypto.randomUUID(),
            direction: 'inbound',
            sender: { kind: 'customer', name: null },
            type: 'text',
            text,
            status: 'pending',
            timestamp: new Date().toISOString(),
        };
        this.store.update((state) => ({ messages: upsertMessages(state.messages, [message]) }));
        void this.flushOutbox();
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
                if (!next?.client_message_id || !next.text) {
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
        try {
            const result = await this.session.withToken((token) => this.api.send(token, {
                client_message_id: clientMessageId,
                text: message.text ?? '',
                page: this.page,
            }));
            const accepted: ChatMessage = { ...message, id: result.message_id, status: 'accepted' };
            this.store.update((state) => ({
                messages: upsertMessages(state.messages, [accepted]),
                notice: state.notice?.fatal ? state.notice : null,
            }));
            this.tabs.post({ type: 'sent', message: accepted });
            this.retryAttempt = 0;
            return true;
        } catch (error) {
            return this.onSendError(clientMessageId, error);
        }
    }


    /** @returns true bila antrean boleh lanjut ke pesan berikutnya. */
    private onSendError(clientMessageId: string, error: unknown): boolean {
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
                this.fatal('session_revoked');
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
        this.realtime.emit('delivered', { up_to: message.timestamp });
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


    private async syncHistory(): Promise<void> {
        const history = await this.session.withToken((token) => this.api.conversation(token));
        this.store.update((state) => ({
            messages: upsertMessages(state.messages, history.messages),
            conversationId: history.conversation?.id ?? state.conversationId,
        }));
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
            this.env.host.event('conversation_started', {});
        }
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
                const page = await this.session.withToken((token) => this.api.messagesAfter(token, after));
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
        this.store.update({ open });
        this.env.host.event(open ? 'open' : 'close');
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
            this.realtime.emit('read', {});
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
            this.realtime.disconnect();
            this.session.clear();
            this.store.update({ messages: [], unread: 0, conversationId: null, trustLevel: null });
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
            this.store.update({
                prechatPending: false, prechatBusy: false, trustLevel: result.trust_level, notice: null,
            });
            this.view.focusInput();
        } catch (error) {
            this.store.update({ prechatBusy: false, prechatError: error instanceof ApiError ? error.code : 'unknown' });
            if (error instanceof ApiError && FATAL_SESSION_CODES.includes(error.code)) {
                this.fatal(error.code);
            }
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
            this.store.update({ trustLevel: session.trust_level, conversationId, prechatPending: false });
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
        }
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
        this.realtime.disconnect();
        await this.session.shutdown();
        this.store.update({
            messages: [], unread: 0, conversationId: null, trustLevel: null, open: false, prechatPending: false,
        });
    }


    /* ── tampilan & laporan ke loader ── */

    private render(state: AppState): void {
        const stopped = state.notice?.fatal === true && !state.open;
        // Launcher disembunyikan oleh website (opsi `hideLauncher`) ATAU pengaturan tenant di dashboard
        // (`appearance.hide_launcher`) — chat dibuka lewat tombol website sendiri (`Plasgos("open")`).
        const hiddenBySettings = state.config?.appearance.hide_launcher === true;
        const launcherHidden = this.hideLauncher || hiddenBySettings || state.config === null || stopped;
        const layout = frameLayout(state.open, state.config?.appearance ?? {}, this.viewport, launcherHidden);
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

function pageOf(value: unknown): PageInfo | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const record = value as Record<string, unknown>;
    return typeof record['url'] === 'string' ? { url: record['url'], title: typeof record['title'] === 'string' ? record['title'] : '' } : null;
}
