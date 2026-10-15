import { safeColor, textOn } from '../colors';
import type { MessageKey } from '../i18n';
import { errorText, formatNextOpen, replyEstimateText, translate } from '../i18n';
import { renderMarkdown } from '../markdown';
import { availabilityOf, handoffOffered, needsOfflineForm } from '../store';
import type { AppState } from '../store';
import type { ChatMessage, MessageActions, MessageLocation } from '../types';
import { OfflineForm } from './offline';
import type { OfflineValues } from './offline';
import { OtpPanel } from './otp';
import { PrechatForm } from './prechat';
import { surveyCard, surveyQuestionOf } from './survey';
import type { PrechatValues } from './prechat';
import { STYLES } from './styles';
import { TranscriptPanel } from './transcript';

export interface ViewActions {
    readonly toggle: () => void;
    readonly close: () => void;
    readonly send: (text: string) => void;
    readonly retry: (clientMessageId: string) => void;
    readonly attach: (file: File) => void;
    /** Klik pilihan pada pesan tim (W7b) — dikirim sebagai postback. */
    readonly choose: (messageId: string, item: { id: string; title: string }) => void;
    /** Tautan lampiran kedaluwarsa (gambar gagal dimuat) → ambil ulang riwayat untuk tautan baru. */
    readonly mediaExpired: () => void;
    readonly typing: () => void;
    readonly toggleSound: () => void;
    readonly interact: () => void;
    readonly submitPrechat: (values: PrechatValues) => void;
    readonly skipPrechat: () => void;
    readonly openOtp: () => void;
    readonly requestOtp: (email: string) => void;
    readonly verifyOtp: (code: string) => void;
    readonly otpChangeEmail: () => void;
    readonly submitOffline: (values: OfflineValues) => void;
    readonly rate: (score: number) => void;
    readonly surveyComment: (text: string) => void;
    readonly openTranscript: () => void;
    readonly closeTranscript: () => void;
    readonly sendTranscript: (email: string | null) => void;
    readonly requestHandoff: () => void;
    /** Pesan proaktif di atas launcher (W8b): diklik = buka chat; tutup = sembunyikan tanpa membuka. */
    readonly openTeaser: () => void;
    readonly dismissTeaser: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
    chat: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    close: 'M6 6l12 12M18 6L6 18',
    send: 'M4 12l16-8-6 16-2-6-8-2z',
    soundOn: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6',
    soundOff: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
    mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
    clip: 'M16 7l-7.5 7.5a2 2 0 0 0 2.8 2.8L19 9.6a4 4 0 0 0-5.7-5.7L5.6 11.6a6 6 0 0 0 8.5 8.5L20 14.2',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
} as const;

/** Tautan lampiran yang boleh dirender: dari server (`https:`) atau pratinjau lokal (`blob:`). */
function safeMediaUrl(url: string | null | undefined): string | null {
    return typeof url === 'string' && /^(https:|blob:)/i.test(url) ? url : null;
}

function fileSize(bytes: number | null, locale: string): string {
    if (bytes === null || !Number.isFinite(bytes)) {
        return '';
    }
    const format = new Intl.NumberFormat(locale === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: 1 });
    return bytes >= 1024 * 1024 ? `${format.format(bytes / (1024 * 1024))} MB` : `${format.format(Math.max(1, bytes / 1024))} KB`;
}

const STATUS_KEY: Readonly<Record<string, MessageKey>> = {
    pending: 'sending',
    accepted: 'sent',
    sent: 'sent',
    unread: 'delivered',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
};

/** Lebih dekat dari ini ke dasar daftar = pengunjung sedang membaca pesan terbaru → ikut turun saat ada pesan baru. */
const STICK_TO_BOTTOM_PX = 80;

function messageKey(message: ChatMessage): string {
    return message.client_message_id && message.direction === 'inbound' ? `c:${message.client_message_id}` : `m:${message.id ?? ''}`;
}

/** Tampilan widget: DOM dibangun `createElement`; isi pesan tak pernah lewat `innerHTML`. */
/** `identity.verification: "required"`: pengunjung belum terverifikasi tak bisa menulis (server juga menolak). */
function needsIdentity(state: AppState): boolean {
    return state.config?.identity?.verification === 'required' && state.trustLevel !== 'verified';
}


/** Formulir offline tampil (W5b) — kecuali widget menunggu verifikasi identitas/captcha (itu didahulukan). */
function showsOfflineForm(state: AppState): boolean {
    return needsOfflineForm(state) && !needsIdentity(state) && state.captchaSiteKey === null
        && state.notice?.fatal !== true;
}


/**
 * Baris status di header: tutup → "Kami kembali Senin 09.00 WIB"; away → tim offline; buka → tim online + estimasi
 * balas (bila ada kebijakan SLA). null = baris disembunyikan.
 */
function teamStatusOf(state: AppState): { text: string; online: boolean } | null {
    const status = availabilityOf(state);
    if (status === 'closed') {
        const when = state.nextOpenAt ? formatNextOpen(state.locale, state.nextOpenAt, state.hoursTimezone) : '';
        return { text: when ? translate(state.locale, 'backAt', { when }) : translate(state.locale, 'closedNow'), online: false };
    }
    if (status === 'away') {
        return { text: translate(state.locale, 'teamOffline'), online: false };
    }
    const estimate = state.replyEstimateMinutes ? replyEstimateText(state.locale, state.replyEstimateMinutes) : null;
    if (state.teamOnline === true) {
        return { text: estimate ? `${translate(state.locale, 'teamOnline')} · ${estimate}` : translate(state.locale, 'teamOnline'), online: true };
    }
    return estimate ? { text: estimate, online: false } : null;
}


/** Galat panel OTP → teks: salah kode (sisa percobaan), kedaluwarsa, terkunci; lainnya teks galat umum. */
function otpErrorText(state: AppState, error: NonNullable<AppState['otp']>['error'] & object): string {
    const keys: Partial<Record<string, MessageKey>> = { otp_wrong: 'otpWrongCode', otp_expired: 'otpExpired', otp_locked: 'otpLocked' };
    const key = keys[error.code];
    return key ? translate(state.locale, key, error.vars ?? {}) : errorText(state.locale, error.code, error.vars ?? {});
}


export class ChatView {
    private readonly root: HTMLDivElement;

    private readonly launcher: HTMLButtonElement;

    private readonly badge: HTMLSpanElement;

    /** Pesan proaktif di atas launcher (W8b). */
    private readonly teaser: HTMLDivElement;

    private readonly teaserBody: HTMLButtonElement;

    private readonly teaserSender: HTMLSpanElement;

    private readonly teaserText: HTMLSpanElement;

    private readonly teaserClose: HTMLButtonElement;

    private readonly window: HTMLElement;

    private readonly title: HTMLHeadingElement;

    private readonly greeting: HTMLParagraphElement;

    private readonly teamStatus: HTMLParagraphElement;

    private readonly logo: HTMLImageElement;

    private readonly soundButton: HTMLButtonElement;

    private readonly closeButton: HTMLButtonElement;

    private readonly notice: HTMLDivElement;

    private readonly list: HTMLOListElement;

    private readonly typingLine: HTMLDivElement;

    private readonly captcha: HTMLDivElement;

    private readonly prechat: PrechatForm;

    private readonly otp: OtpPanel;

    private readonly otpEntry: HTMLButtonElement;

    private readonly handoffEntry: HTMLButtonElement;

    private readonly offline: OfflineForm;

    private readonly transcript: TranscriptPanel;

    private readonly transcriptButton: HTMLButtonElement;

    private readonly input: HTMLTextAreaElement;

    private readonly sendButton: HTMLButtonElement;

    private readonly attachButton: HTMLButtonElement;

    private readonly fileInput: HTMLInputElement;

    private renderedKeys = '';


    public constructor(private readonly doc: Document, private readonly actions: ViewActions) {
        const style = doc.createElement('style');
        style.textContent = STYLES;
        doc.head.appendChild(style);

        this.root = this.element('div', 'pw-root');
        this.launcher = this.element('button', 'pw-launcher');
        this.launcher.type = 'button';
        this.launcher.appendChild(this.icon(ICONS.chat, 26));
        this.badge = this.element('span', 'pw-badge');
        this.badge.setAttribute('aria-hidden', 'true');
        this.launcher.appendChild(this.badge);
        this.teaser = this.element('div', 'pw-teaser');
        this.teaser.hidden = true;
        this.teaserBody = this.element('button', 'pw-teaser-body');
        this.teaserBody.type = 'button';
        this.teaserSender = this.element('span', 'pw-teaser-sender');
        this.teaserText = this.element('span', 'pw-teaser-text');
        this.teaserBody.append(this.teaserSender, this.teaserText);
        this.teaserClose = this.element('button', 'pw-teaser-close');
        this.teaserClose.type = 'button';
        this.teaserClose.appendChild(this.icon(ICONS.close, 14));
        this.teaser.append(this.teaserBody, this.teaserClose);

        this.window = this.element('section', 'pw-window');
        this.window.setAttribute('role', 'dialog');
        const header = this.element('header', 'pw-header');
        this.logo = this.element('img', 'pw-logo');
        this.logo.alt = '';
        const headText = this.element('div', 'pw-head-text');
        this.title = this.element('h2', 'pw-title');
        this.title.id = 'pw-title';
        this.greeting = this.element('p', 'pw-greeting');
        this.teamStatus = this.element('p', 'pw-team-status');
        this.teamStatus.setAttribute('aria-live', 'polite');
        headText.append(this.title, this.teamStatus, this.greeting);
        this.transcriptButton = this.iconButton(ICONS.mail);
        this.soundButton = this.iconButton(ICONS.soundOn);
        this.closeButton = this.iconButton(ICONS.close);
        header.append(this.logo, headText, this.transcriptButton, this.soundButton, this.closeButton);
        this.window.setAttribute('aria-labelledby', 'pw-title');

        this.notice = this.element('div', 'pw-notice');
        this.list = this.element('ol', 'pw-messages');
        this.list.setAttribute('aria-live', 'polite');
        this.list.setAttribute('aria-relevant', 'additions');
        this.typingLine = this.element('div', 'pw-typing');
        this.typingLine.setAttribute('aria-live', 'polite');
        this.captcha = this.element('div', 'pw-captcha');
        this.prechat = new PrechatForm(doc, { submit: actions.submitPrechat, skip: actions.skipPrechat });
        this.otp = new OtpPanel(doc, {
            request: actions.requestOtp,
            verify: actions.verifyOtp,
            changeEmail: actions.otpChangeEmail,
        });
        this.offline = new OfflineForm(doc, { submit: actions.submitOffline });
        this.transcript = new TranscriptPanel(doc, { send: actions.sendTranscript, close: actions.closeTranscript });
        this.otpEntry = this.element('button', 'pw-otp-entry');
        this.otpEntry.type = 'button';
        this.otpEntry.addEventListener('click', () => {
            actions.openOtp();
        });

        // "Bicara dengan tim" (W6c) — di atas kolom tulis, hanya selama AI yang menjawab.
        this.handoffEntry = this.element('button', 'pw-otp-entry pw-handoff');
        this.handoffEntry.type = 'button';
        this.handoffEntry.addEventListener('click', () => {
            actions.requestHandoff();
        });

        const composer = this.element('form', 'pw-composer');
        const label = this.element('label', 'pw-sr');
        label.htmlFor = 'pw-input';
        this.input = this.element('textarea', 'pw-input');
        this.input.id = 'pw-input';
        this.input.rows = 1;
        this.input.maxLength = 4000;
        this.sendButton = this.element('button', 'pw-send');
        this.sendButton.type = 'submit';
        this.sendButton.appendChild(this.icon(ICONS.send, 20));
        // Lampiran (W7a): tombol klip + input berkas tersembunyi (jenis dari pengaturan widget).
        this.attachButton = this.element('button', 'pw-attach');
        this.attachButton.type = 'button';
        this.attachButton.appendChild(this.icon(ICONS.clip, 20));
        this.fileInput = this.element('input', 'pw-file-input');
        this.fileInput.type = 'file';
        this.fileInput.hidden = true;
        composer.append(label, this.attachButton, this.fileInput, this.input, this.sendButton);
        this.window.append(
            header, this.notice, this.otpEntry, this.list, this.typingLine, this.captcha, this.prechat.element,
            this.otp.element, this.offline.element, this.transcript.element, this.handoffEntry, composer,
        );
        this.root.append(this.teaser, this.launcher, this.window);

        this.bind(composer, label);
    }


    public mount(container: HTMLElement): void {
        container.replaceChildren(this.root);
    }


    public get captchaContainer(): HTMLDivElement {
        return this.captcha;
    }


    public focusInput(): void {
        this.input.focus();
    }


    /** Formulir offline terkirim — isian dikosongkan, fokus ke kotak tulis. */
    public offlineSubmitted(): void {
        this.offline.reset();
        this.input.focus();
    }


    public focusLauncher(): void {
        this.launcher.focus();
    }


    public render(state: AppState, layout: { readonly fullscreen: boolean; readonly hideLauncher: boolean }): void {
        const t = (key: MessageKey, vars?: Record<string, string | number>): string =>
            translate(state.locale, key, vars);
        const look = state.config?.appearance ?? {};
        const color = safeColor(look.primary_color);
        const docElement = this.doc.documentElement;
        docElement.lang = state.locale;
        docElement.style.setProperty('--pw-primary', color);
        docElement.style.setProperty('--pw-on-primary', textOn(color));
        docElement.dataset['theme'] = this.themeOf(look.theme);
        this.root.dataset['position'] = look.position === 'left' ? 'left' : 'right';
        this.root.dataset['fullscreen'] = String(layout.fullscreen && state.open);

        this.launcher.hidden = state.open || layout.hideLauncher || state.config === null;
        this.launcher.setAttribute('aria-expanded', String(state.open));
        this.launcher.setAttribute('aria-label', state.unread > 0
            ? `${look.launcher_label ?? t('openChat')} — ${t('unreadBadge', { count: state.unread })}`
            : look.launcher_label ?? t('openChat'));
        this.badge.hidden = state.unread === 0;
        this.badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
        const teaser = state.open || layout.hideLauncher ? null : state.teaser;
        this.teaser.hidden = teaser === null;
        if (teaser) {
            this.teaserSender.textContent = teaser.sender.name ?? look.team_title ?? t('defaultTitle');
            this.teaserText.textContent = teaser.text;
            this.teaserBody.setAttribute('aria-label', `${t('openChat')}: ${teaser.text}`);
            this.teaserClose.setAttribute('aria-label', t('dismissTeaser'));
        }

        this.window.hidden = !state.open;
        this.title.textContent = look.team_title ?? t('defaultTitle');
        this.greeting.textContent = look.greeting ?? '';
        this.greeting.hidden = !look.greeting;
        const teamStatus = teamStatusOf(state);
        this.teamStatus.hidden = teamStatus === null;
        this.teamStatus.dataset['online'] = String(teamStatus?.online === true);
        this.teamStatus.textContent = teamStatus?.text ?? '';
        this.logo.hidden = !look.logo_url;
        if (look.logo_url && this.logo.src !== look.logo_url) {
            this.logo.src = look.logo_url;
        }
        this.closeButton.setAttribute('aria-label', t('closeChat'));
        // Transkrip hanya bila sudah ada percakapan (W5c).
        this.transcriptButton.hidden = state.conversationId === null;
        this.transcriptButton.setAttribute('aria-label', t('transcriptOpen'));
        this.transcriptButton.title = t('transcriptOpen');
        this.transcript.render(state.transcript ? {
            emailOnFile: state.emailOnFile,
            busy: state.transcript.busy,
            sent: state.transcript.sent,
            error: state.transcript.error ? errorText(state.locale, state.transcript.error) : null,
            t,
        } : null);
        this.soundButton.setAttribute('aria-label', state.soundEnabled ? t('soundOff') : t('soundOn'));
        this.soundButton.replaceChildren(this.icon(state.soundEnabled ? ICONS.soundOn : ICONS.soundOff, 20));

        this.renderNotice(state);
        this.renderMessages(state, t);
        this.typingLine.textContent = state.agentTypingUntil > Date.now() ? t('typing') : '';
        this.captcha.hidden = state.captchaSiteKey === null;
        this.input.placeholder = t('inputPlaceholder');
        this.sendButton.setAttribute('aria-label', t('send'));
        const offlineForm = showsOfflineForm(state);
        const offlineMode = state.config?.offline;
        this.offline.render(offlineForm ? {
            intro: offlineMode?.message ?? t(availabilityOf(state) === 'closed' ? 'offlineIntroClosed' : 'offlineIntroAway'),
            busy: state.offlineBusy,
            error: state.offlineError ? errorText(state.locale, state.offlineError) : null,
            t,
        } : null);
        const prechat = state.config?.prechat;
        // Formulir offline menggantikan pre-chat (server mencatat pre-chat terpenuhi saat pesan offline dikirim).
        this.prechat.render(state.prechatPending && prechat && !offlineForm ? {
            fields: prechat.fields,
            optional: prechat.mode === 'optional',
            consentText: state.config.privacy?.consent_text ?? null,
            busy: state.prechatBusy,
            failed: state.prechatError !== null,
            t,
        } : null);
        // Widget wajib terverifikasi tanpa login website: pengunjung bisa membuktikan email (OTP, W4c).
        const otpAllowed = needsIdentity(state) && state.config?.identity?.otp_email !== false;
        this.otpEntry.hidden = !otpAllowed || state.otp !== null;
        this.otpEntry.textContent = t('otpEntry');
        this.handoffEntry.hidden = !handoffOffered(state);
        this.handoffEntry.disabled = state.handoffBusy;
        this.handoffEntry.textContent = t(state.handoffBusy ? 'handoffBusy' : 'handoffOpen');
        this.otp.render(state.otp ? {
            step: state.otp.step,
            email: state.otp.email,
            busy: state.otp.busy,
            error: state.otp.error ? otpErrorText(state, state.otp.error) : null,
            t,
        } : null);
        const blocked = state.notice?.fatal === true || state.captchaSiteKey !== null || state.config === null
            || needsIdentity(state) || state.prechatPending || offlineForm;
        this.input.disabled = blocked;
        this.sendButton.disabled = blocked;
        const attachments = state.config?.attachments;
        this.attachButton.hidden = !attachments?.enabled;
        this.attachButton.disabled = blocked;
        this.attachButton.setAttribute('aria-label', t('attach'));
        this.attachButton.title = t('attach');
        this.fileInput.accept = (attachments?.mime_allow ?? []).join(',');
    }


    private renderNotice(state: AppState): void {
        const notice = state.notice;
        if (notice) {
            this.notice.hidden = false;
            this.notice.dataset['tone'] = 'error';
            this.notice.setAttribute('role', 'alert');
            this.notice.textContent = errorText(state.locale, notice.code, notice.vars ?? {});
            return;
        }

        if (needsIdentity(state)) {
            this.notice.hidden = false;
            this.notice.dataset['tone'] = 'info';
            this.notice.setAttribute('role', 'status');
            this.notice.textContent = translate(state.locale, 'identityRequired');
            return;
        }

        // Tim menandai urusan selesai (W5c) — pengunjung tetap bisa menulis (membuka lagi).
        if (state.conversationStatus === 'resolved' && state.connection === 'online') {
            this.notice.hidden = false;
            this.notice.dataset['tone'] = 'info';
            this.notice.setAttribute('role', 'status');
            this.notice.textContent = translate(state.locale, 'conversationResolved');
            return;
        }

        // Tim offline tetapi alamat balasan sudah diketahui: pengunjung menulis biasa, balasan juga lewat email.
        if (availabilityOf(state) !== 'open' && state.emailOnFile && state.config?.offline?.mode !== 'hidden'
            && state.config?.availability && state.connection === 'online') {
            this.notice.hidden = false;
            this.notice.dataset['tone'] = 'info';
            this.notice.setAttribute('role', 'status');
            this.notice.textContent = translate(state.locale, 'offlineEmailOnFile');
            return;
        }

        if (state.connection === 'offline' || state.connection === 'connecting') {
            this.notice.hidden = false;
            this.notice.dataset['tone'] = 'info';
            this.notice.setAttribute('role', 'status');
            this.notice.textContent = translate(state.locale, state.connection === 'offline' ? 'offline' : 'reconnecting');
            return;
        }

        this.notice.hidden = true;
        this.notice.textContent = '';
    }


    private renderMessages(state: AppState, t: (key: MessageKey) => string): void {
        const survey = state.survey;
        const surveyKey = survey ? [survey.status, survey.score, survey.comment, survey.comment_allowed].join(':') : '';
        const signature = `${state.locale}|${surveyKey}|${String(state.surveyBusy)}|${state.surveyError ?? ''}|`
            + state.messages.map((message) => `${messageKey(message)}|${message.status ?? ''}|${message.id ?? ''}|${message.attachment?.url ?? ''}`).join(',');
        if (signature === this.renderedKeys) {
            return;
        }
        this.renderedKeys = signature;
        const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < STICK_TO_BOTTOM_PX;
        // Kartu penilaian hanya di pesan survei TERAKHIR (keadaan survei yang diketahui adalah survei terakhir).
        const lastRating = state.messages.map((message) => message.survey?.kind).lastIndexOf('rating');
        const lastIndex = state.messages.length - 1;
        this.list.replaceChildren(...state.messages.map((message, index) => this.messageItem(
            message, state, t, index === lastRating, index === lastIndex,
        )));
        if (atBottom) {
            this.list.scrollTop = this.list.scrollHeight;
        }
    }


    private messageItem(
        message: ChatMessage,
        state: AppState,
        t: (key: MessageKey) => string,
        ratingCard: boolean,
        last: boolean,
    ): HTMLLIElement {
        const visitor = message.direction === 'inbound';
        const item = this.element('li', 'pw-msg');
        item.dataset['side'] = visitor ? 'visitor' : 'team';
        const bubble = this.element('div', 'pw-bubble');
        // Pesan survei dengan kartu penilaian: daftar pilihan bernomor diganti tombol.
        const text = ratingCard ? surveyQuestionOf(message.text) : message.text ?? '';
        if (message.actions?.image_url && safeMediaUrl(message.actions.image_url)) {
            const image = this.element('img', 'pw-card-img');
            image.src = message.actions.image_url;
            image.alt = message.actions.header ?? '';
            image.loading = 'lazy';
            bubble.appendChild(image);
        }
        if (message.actions?.header) {
            const header = this.element('div', 'pw-card-header');
            header.textContent = message.actions.header;
            bubble.appendChild(header);
        }
        if (message.attachment) {
            bubble.appendChild(this.attachmentView(message.attachment, state, t));
        }
        if (text) {
            bubble.appendChild(renderMarkdown(this.doc, text));
        }
        if (message.location) {
            bubble.appendChild(this.locationView(message.location, t));
        }
        if (message.actions?.footer) {
            const footer = this.element('div', 'pw-card-footer');
            footer.textContent = message.actions.footer;
            bubble.appendChild(footer);
        }
        // Tombol, daftar & tautan menempel di gelembung; balasan cepat hanya di pesan TERAKHIR (standar chat).
        const actions = message.actions && message.id && !visitor
            ? this.actionsView(message.id, message.actions, last)
            : null;
        if (actions) {
            bubble.appendChild(actions);
        }
        const meta = this.element('div', 'pw-meta');
        const time = new Date(message.timestamp);
        const clock = Number.isNaN(time.getTime())
            ? ''
            : time.toLocaleTimeString(state.locale === 'id' ? 'id-ID' : 'en-US', { hour: '2-digit', minute: '2-digit' });
        if (!visitor) {
            meta.append(this.doc.createTextNode(`${message.sender.name ?? (message.sender.kind === 'bot' ? t('bot') : t('agent'))} · ${clock}`));
        } else {
            const statusKey = STATUS_KEY[String(message.status)];
            meta.append(this.doc.createTextNode(statusKey ? `${clock} · ${t(statusKey)}` : clock));
            if (message.status === 'failed' && message.client_message_id) {
                const retry = this.element('button', 'pw-retry');
                retry.type = 'button';
                retry.textContent = t('retry');
                const clientMessageId = message.client_message_id;
                retry.addEventListener('click', () => {
                    this.actions.retry(clientMessageId);
                });
                meta.appendChild(retry);
            }
        }
        item.append(bubble, meta);
        if (ratingCard && message.survey?.kind === 'rating') {
            item.appendChild(surveyCard(this.doc, {
                scale: message.survey.scale,
                survey: state.survey,
                busy: state.surveyBusy,
                error: state.surveyError ? errorText(state.locale, state.surveyError) : null,
                t: (key, vars) => translate(state.locale, key, vars),
            }, { rate: this.actions.rate, comment: this.actions.surveyComment }));
        }
        return item;
    }


    private actionsView(messageId: string, actions: MessageActions, last: boolean): HTMLElement | null {
        const items = actions.items.filter((item) => item.id && item.title);
        if (!items.length || (actions.kind === 'quick_replies' && !last)) {
            return null;
        }
        const choose = (item: { id: string; title: string }): void => {
            this.actions.interact();
            this.actions.choose(messageId, { id: item.id, title: item.title });
        };
        if (actions.kind === 'link') {
            const box = this.element('div', 'pw-actions');
            for (const item of items) {
                const url = safeMediaUrl(item.url);
                if (!url || url.startsWith('blob:')) {
                    continue;
                }
                const link = this.element('a', 'pw-action pw-action-link');
                link.href = url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = item.title;
                box.appendChild(link);
            }
            return box.childElementCount ? box : null;
        }
        if (actions.kind === 'list') {
            const box = this.element('div', 'pw-actions pw-list');
            const toggle = this.element('button', 'pw-action');
            toggle.type = 'button';
            toggle.textContent = actions.button_text ?? 'Pilih';
            const panel = this.element('div', 'pw-list-panel');
            panel.hidden = true;
            let section: string | null = null;
            for (const item of items) {
                if (item.section && item.section !== section) {
                    section = item.section;
                    const heading = this.element('div', 'pw-list-section');
                    heading.textContent = section;
                    panel.appendChild(heading);
                }
                const row = this.element('button', 'pw-list-row');
                row.type = 'button';
                const title = this.element('span', 'pw-list-title');
                title.textContent = item.title;
                row.appendChild(title);
                if (item.description) {
                    const description = this.element('span', 'pw-list-description');
                    description.textContent = item.description;
                    row.appendChild(description);
                }
                row.addEventListener('click', () => {
                    choose(item);
                });
                panel.appendChild(row);
            }
            toggle.setAttribute('aria-expanded', 'false');
            toggle.addEventListener('click', () => {
                panel.hidden = !panel.hidden;
                toggle.setAttribute('aria-expanded', String(!panel.hidden));
            });
            box.append(toggle, panel);
            return box;
        }
        const box = this.element('div', actions.kind === 'quick_replies' ? 'pw-actions pw-quick' : 'pw-actions');
        for (const item of items) {
            const button = this.element('button', actions.kind === 'quick_replies' ? 'pw-chip' : 'pw-action');
            button.type = 'button';
            button.textContent = item.title;
            button.addEventListener('click', () => {
                choose(item);
            });
            box.appendChild(button);
        }
        return box;
    }


    private locationView(location: MessageLocation, t: (key: MessageKey) => string): HTMLElement {
        const box = this.element('div', 'pw-location');
        if (location.name) {
            const name = this.element('div', 'pw-location-name');
            name.textContent = location.name;
            box.appendChild(name);
        }
        if (location.address) {
            const address = this.element('div', 'pw-location-address');
            address.textContent = location.address;
            box.appendChild(address);
        }
        const url = safeMediaUrl(location.url);
        if (url) {
            const link = this.element('a', 'pw-action pw-action-link');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = t('openMap');
            box.appendChild(link);
        }
        return box;
    }


    /** Gambar → pratinjau (klik = buka); berkas lain → kartu nama & ukuran. Tanpa tautan sah → nama saja. */
    private attachmentView(attachment: NonNullable<ChatMessage['attachment']>, state: AppState, t: (key: MessageKey) => string): HTMLElement {
        const url = safeMediaUrl(attachment.url);
        const name = attachment.filename ?? t('attachmentOpen');
        if (attachment.type === 'image' && url) {
            const link = this.element('a', 'pw-attachment-image');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.setAttribute('aria-label', `${t('attachmentOpen')}: ${name}`);
            const image = this.element('img', 'pw-attachment-img');
            image.src = url;
            image.alt = name;
            image.loading = 'lazy';
            image.addEventListener('error', () => {
                this.actions.mediaExpired();
            }, { once: true });
            link.appendChild(image);
            return link;
        }
        const card = this.element(url ? 'a' : 'div', 'pw-attachment-file');
        if (url && card instanceof HTMLAnchorElement) {
            card.href = url;
            card.target = '_blank';
            card.rel = 'noopener noreferrer';
            card.setAttribute('download', name);
        }
        const label = this.element('span', 'pw-attachment-name');
        label.textContent = name;
        const size = this.element('span', 'pw-attachment-size');
        size.textContent = fileSize(attachment.size, state.locale);
        card.append(this.icon(ICONS.file, 18), label, size);
        return card;
    }


    private themeOf(theme: string | undefined): string {
        if (theme === 'dark' || theme === 'light') {
            return theme;
        }
        // jsdom & sebagian WebView tak punya matchMedia — tipe lib DOM menganggapnya selalu ada.
        const matchMedia: unknown = this.doc.defaultView ? Reflect.get(this.doc.defaultView, 'matchMedia') : undefined;
        const prefersDark = typeof matchMedia === 'function'
            && (matchMedia as Window['matchMedia']).call(this.doc.defaultView, '(prefers-color-scheme: dark)').matches;
        return prefersDark && theme === 'auto' ? 'dark' : 'light';
    }


    private bind(composer: HTMLFormElement, label: HTMLLabelElement): void {
        label.textContent = 'Pesan';
        this.attachButton.addEventListener('click', () => {
            this.actions.interact();
            this.fileInput.click();
        });
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            this.fileInput.value = '';
            if (file) {
                this.actions.attach(file);
            }
        });
        this.launcher.addEventListener('click', () => {
            this.actions.interact();
            this.actions.toggle();
        });
        this.teaserBody.addEventListener('click', () => {
            this.actions.interact();
            this.actions.openTeaser();
        });
        this.teaserClose.addEventListener('click', () => {
            this.actions.dismissTeaser();
        });
        this.closeButton.addEventListener('click', () => {
            this.actions.close();
        });
        this.transcriptButton.addEventListener('click', () => {
            this.actions.openTranscript();
        });
        this.soundButton.addEventListener('click', () => {
            this.actions.interact();
            this.actions.toggleSound();
        });
        composer.addEventListener('submit', (event) => {
            event.preventDefault();
            this.submit();
        });
        this.input.addEventListener('keydown', (event) => {
            this.actions.interact();
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                this.submit();
            }
        });
        this.input.addEventListener('input', () => {
            this.input.style.height = 'auto';
            this.input.style.height = `${String(Math.min(this.input.scrollHeight, 120))}px`;
            this.actions.typing();
        });
        this.window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.actions.close();
            }
        });
    }


    private submit(): void {
        const text = this.input.value.trim();
        if (!text || this.input.disabled) {
            return;
        }
        this.input.value = '';
        this.input.style.height = 'auto';
        this.actions.send(text);
    }


    private element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
        const element = this.doc.createElement(tag);
        element.className = className;
        return element;
    }


    private iconButton(path: string): HTMLButtonElement {
        const button = this.element('button', 'pw-icon-btn');
        button.type = 'button';
        button.appendChild(this.icon(path, 20));
        return button;
    }


    private icon(path: string, size: number): SVGSVGElement {
        const svg = this.doc.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(size));
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const shape = this.doc.createElementNS(SVG_NS, 'path');
        shape.setAttribute('d', path);
        svg.appendChild(shape);
        return svg;
    }
}
