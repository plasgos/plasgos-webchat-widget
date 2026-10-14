import type { MessageKey } from '../i18n';

export interface TranscriptActions {
    readonly send: (email: string | null) => void;
    readonly close: () => void;
}

export interface TranscriptView {
    /** Alamat balasan sudah diketahui server → kolom email tak ditampilkan. */
    readonly emailOnFile: boolean;
    readonly busy: boolean;
    readonly sent: boolean;
    /** Teks galat siap tampil, atau null. */
    readonly error: string | null;
    readonly t: (key: MessageKey) => string;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

/** Panel "kirim transkrip ke email" (W5c) — pola yang sama dengan panel OTP: satu kolom, satu tombol. */
export class TranscriptPanel {
    public readonly element: HTMLFormElement;

    private readonly heading: HTMLParagraphElement;

    private readonly hint: HTMLParagraphElement;

    private readonly field: HTMLDivElement;

    private readonly label: HTMLLabelElement;

    private readonly input: HTMLInputElement;

    private readonly error: HTMLParagraphElement;

    private readonly submit: HTMLButtonElement;

    private readonly close: HTMLButtonElement;

    private emailOnFile = false;

    private translate: TranscriptView['t'] = (key) => key;


    public constructor(private readonly doc: Document, private readonly actions: TranscriptActions) {
        this.element = this.make('form', 'pw-otp pw-transcript');
        this.element.noValidate = true;
        this.heading = this.make('p', 'pw-otp-title');
        this.hint = this.make('p', 'pw-otp-hint');
        this.hint.setAttribute('aria-live', 'polite');
        this.field = this.make('div', 'pw-field');
        this.label = this.make('label', 'pw-field-label');
        this.label.htmlFor = 'pw-transcript-email';
        this.input = this.make('input', 'pw-field-input');
        this.input.id = 'pw-transcript-email';
        this.input.type = 'email';
        this.input.autocomplete = 'email';
        this.input.maxLength = 254;
        this.error = this.make('p', 'pw-field-error');
        this.error.setAttribute('role', 'alert');
        this.field.append(this.label, this.input);
        const buttons = this.make('div', 'pw-prechat-actions');
        this.close = this.make('button', 'pw-prechat-skip');
        this.close.type = 'button';
        this.submit = this.make('button', 'pw-prechat-submit');
        this.submit.type = 'submit';
        buttons.append(this.close, this.submit);
        this.element.append(this.heading, this.hint, this.field, this.error, buttons);
        this.element.addEventListener('submit', (event) => {
            event.preventDefault();
            this.onSubmit();
        });
        this.close.addEventListener('click', () => {
            this.actions.close();
        });
    }


    public render(view: TranscriptView | null): void {
        this.element.hidden = view === null;
        if (!view) {
            return;
        }
        this.translate = view.t;
        this.emailOnFile = view.emailOnFile;
        this.heading.textContent = view.t('transcriptTitle');
        this.hint.textContent = view.t(view.sent ? 'transcriptSent' : 'transcriptHint');
        this.label.textContent = view.t('otpEmailLabel');
        this.field.hidden = view.emailOnFile || view.sent;
        this.submit.hidden = view.sent;
        this.submit.textContent = view.t('transcriptSend');
        this.submit.disabled = view.busy;
        this.close.textContent = view.t('transcriptClose');
        this.error.hidden = view.error === null;
        this.error.textContent = view.error ?? '';
    }


    private onSubmit(): void {
        if (this.emailOnFile) {
            this.actions.send(null);
            return;
        }
        const value = this.input.value.trim();
        if (!EMAIL.test(value)) {
            this.error.hidden = false;
            this.error.textContent = this.translate('prechatInvalidEmail');
            this.input.setAttribute('aria-invalid', 'true');
            this.input.focus();
            return;
        }
        this.input.setAttribute('aria-invalid', 'false');
        this.actions.send(value.toLowerCase());
    }


    private make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
        const element = this.doc.createElement(tag);
        element.className = className;
        return element;
    }
}
