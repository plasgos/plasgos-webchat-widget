import { safeColor, textOn } from '../colors';
import type { MessageKey } from '../i18n';
import { errorText, translate } from '../i18n';
import { renderMarkdown } from '../markdown';
import type { AppState } from '../store';
import type { ChatMessage } from '../types';
import { OtpPanel } from './otp';
import { PrechatForm } from './prechat';
import type { PrechatValues } from './prechat';
import { STYLES } from './styles';

export interface ViewActions {
    readonly toggle: () => void;
    readonly close: () => void;
    readonly send: (text: string) => void;
    readonly retry: (clientMessageId: string) => void;
    readonly typing: () => void;
    readonly toggleSound: () => void;
    readonly interact: () => void;
    readonly submitPrechat: (values: PrechatValues) => void;
    readonly skipPrechat: () => void;
    readonly openOtp: () => void;
    readonly requestOtp: (email: string) => void;
    readonly verifyOtp: (code: string) => void;
    readonly otpChangeEmail: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
    chat: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    close: 'M6 6l12 12M18 6L6 18',
    send: 'M4 12l16-8-6 16-2-6-8-2z',
    soundOn: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6',
    soundOff: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
} as const;

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

    private readonly input: HTMLTextAreaElement;

    private readonly sendButton: HTMLButtonElement;

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
        this.soundButton = this.iconButton(ICONS.soundOn);
        this.closeButton = this.iconButton(ICONS.close);
        header.append(this.logo, headText, this.soundButton, this.closeButton);
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
        this.otpEntry = this.element('button', 'pw-otp-entry');
        this.otpEntry.type = 'button';
        this.otpEntry.addEventListener('click', () => {
            actions.openOtp();
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
        composer.append(label, this.input, this.sendButton);
        this.window.append(
            header, this.notice, this.otpEntry, this.list, this.typingLine, this.captcha, this.prechat.element,
            this.otp.element, composer,
        );
        this.root.append(this.launcher, this.window);

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

        this.window.hidden = !state.open;
        this.title.textContent = look.team_title ?? t('defaultTitle');
        this.greeting.textContent = look.greeting ?? '';
        this.greeting.hidden = !look.greeting;
        this.teamStatus.hidden = state.teamOnline === null;
        this.teamStatus.dataset['online'] = String(state.teamOnline === true);
        this.teamStatus.textContent = state.teamOnline === null ? '' : t(state.teamOnline ? 'teamOnline' : 'teamOffline');
        this.logo.hidden = !look.logo_url;
        if (look.logo_url && this.logo.src !== look.logo_url) {
            this.logo.src = look.logo_url;
        }
        this.closeButton.setAttribute('aria-label', t('closeChat'));
        this.soundButton.setAttribute('aria-label', state.soundEnabled ? t('soundOff') : t('soundOn'));
        this.soundButton.replaceChildren(this.icon(state.soundEnabled ? ICONS.soundOn : ICONS.soundOff, 20));

        this.renderNotice(state);
        this.renderMessages(state, t);
        this.typingLine.textContent = state.agentTypingUntil > Date.now() ? t('typing') : '';
        this.captcha.hidden = state.captchaSiteKey === null;
        this.input.placeholder = t('inputPlaceholder');
        this.sendButton.setAttribute('aria-label', t('send'));
        const prechat = state.config?.prechat;
        this.prechat.render(state.prechatPending && prechat ? {
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
        this.otp.render(state.otp ? {
            step: state.otp.step,
            email: state.otp.email,
            busy: state.otp.busy,
            error: state.otp.error ? otpErrorText(state, state.otp.error) : null,
            t,
        } : null);
        const blocked = state.notice?.fatal === true || state.captchaSiteKey !== null || state.config === null
            || needsIdentity(state) || state.prechatPending;
        this.input.disabled = blocked;
        this.sendButton.disabled = blocked;
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
        const signature = state.messages.map((message) => `${messageKey(message)}|${message.status ?? ''}|${message.id ?? ''}`).join(',');
        if (signature === this.renderedKeys) {
            return;
        }
        this.renderedKeys = signature;
        const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < STICK_TO_BOTTOM_PX;
        this.list.replaceChildren(...state.messages.map((message) => this.messageItem(message, state, t)));
        if (atBottom) {
            this.list.scrollTop = this.list.scrollHeight;
        }
    }


    private messageItem(message: ChatMessage, state: AppState, t: (key: MessageKey) => string): HTMLLIElement {
        const visitor = message.direction === 'inbound';
        const item = this.element('li', 'pw-msg');
        item.dataset['side'] = visitor ? 'visitor' : 'team';
        const bubble = this.element('div', 'pw-bubble');
        bubble.appendChild(renderMarkdown(this.doc, message.text ?? ''));
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
        return item;
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
        this.launcher.addEventListener('click', () => {
            this.actions.interact();
            this.actions.toggle();
        });
        this.closeButton.addEventListener('click', () => {
            this.actions.close();
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
