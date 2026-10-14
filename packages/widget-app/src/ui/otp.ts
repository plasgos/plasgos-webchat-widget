import type { MessageKey } from '../i18n';

export type OtpStep = 'email' | 'code';

export interface OtpActions {
    readonly request: (email: string) => void;
    readonly verify: (code: string) => void;
    readonly changeEmail: () => void;
}

export interface OtpView {
    readonly step: OtpStep;
    readonly email: string;
    readonly busy: boolean;
    /** Teks galat siap tampil (sudah diterjemahkan), atau null. */
    readonly error: string | null;
    readonly t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

/**
 * Verifikasi email lewat kode sekali pakai (W4c): langkah email → langkah kode. Server menjawab permintaan kode
 * dengan cara yang sama untuk alamat apa pun, jadi panel ini juga tak pernah menyiratkan alamat itu dikenal.
 */
export class OtpPanel {
    public readonly element: HTMLFormElement;

    private readonly heading: HTMLParagraphElement;

    private readonly hint: HTMLParagraphElement;

    private readonly label: HTMLLabelElement;

    private readonly input: HTMLInputElement;

    private readonly error: HTMLParagraphElement;

    private readonly submit: HTMLButtonElement;

    private readonly back: HTMLButtonElement;

    private step: OtpStep = 'email';

    private renderedStep: OtpStep | null = null;

    private translate: OtpView['t'] = (key) => key;


    public constructor(private readonly doc: Document, private readonly actions: OtpActions) {
        this.element = this.make('form', 'pw-otp');
        this.element.noValidate = true;
        this.heading = this.make('p', 'pw-otp-title');
        this.hint = this.make('p', 'pw-otp-hint');
        this.label = this.make('label', 'pw-field-label');
        this.label.htmlFor = 'pw-otp-input';
        this.input = this.make('input', 'pw-field-input');
        this.input.id = 'pw-otp-input';
        this.error = this.make('p', 'pw-field-error');
        this.error.id = 'pw-otp-error';
        this.error.setAttribute('role', 'alert');
        this.input.setAttribute('aria-describedby', this.error.id);
        const buttons = this.make('div', 'pw-prechat-actions');
        this.back = this.make('button', 'pw-prechat-skip');
        this.back.type = 'button';
        this.submit = this.make('button', 'pw-prechat-submit');
        this.submit.type = 'submit';
        buttons.append(this.back, this.submit);
        this.element.append(this.heading, this.hint, this.label, this.input, this.error, buttons);
        this.element.addEventListener('submit', (event) => {
            event.preventDefault();
            this.onSubmit();
        });
        this.back.addEventListener('click', () => {
            this.actions.changeEmail();
        });
    }


    public render(view: OtpView | null): void {
        this.element.hidden = view === null;
        if (!view) {
            this.renderedStep = null;
            return;
        }
        this.step = view.step;
        this.translate = view.t;
        if (this.renderedStep !== view.step) {
            this.renderedStep = view.step;
            this.setupStep(view);
        }
        this.submit.disabled = view.busy;
        this.error.hidden = view.error === null;
        this.error.textContent = view.error ?? '';
        this.input.setAttribute('aria-invalid', String(view.error !== null));
    }


    private setupStep(view: OtpView): void {
        const code = view.step === 'code';
        this.heading.textContent = view.t(code ? 'otpCodeTitle' : 'otpEmailTitle');
        this.hint.textContent = code ? view.t('otpCodeHint', { email: view.email }) : view.t('otpEmailHint');
        this.label.textContent = view.t(code ? 'otpCodeLabel' : 'otpEmailLabel');
        this.input.value = code ? '' : view.email;
        this.input.type = code ? 'text' : 'email';
        this.input.inputMode = code ? 'numeric' : 'email';
        this.input.autocomplete = code ? 'one-time-code' : 'email';
        this.input.maxLength = code ? 6 : 254;
        this.submit.textContent = view.t(code ? 'otpVerify' : 'otpSend');
        this.back.hidden = !code;
        this.back.textContent = view.t('otpChangeEmail');
    }


    private onSubmit(): void {
        const value = this.input.value.trim();
        if (this.step === 'email') {
            if (!EMAIL.test(value)) {
                this.showError(this.translate('prechatInvalidEmail'));
                return;
            }
            this.actions.request(value.toLowerCase());
            return;
        }
        if (!/^\d{6}$/.test(value)) {
            this.showError(this.translate('otpCodeFormat'));
            return;
        }
        this.actions.verify(value);
    }


    private showError(text: string): void {
        this.error.hidden = false;
        this.error.textContent = text;
        this.input.setAttribute('aria-invalid', 'true');
        this.input.focus();
    }


    private make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
        const element = this.doc.createElement(tag);
        element.className = className;
        return element;
    }
}
