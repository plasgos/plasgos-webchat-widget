import type { MessageKey } from '../i18n';

export interface OfflineValues {
    readonly text: string;
    readonly email: string;
    readonly name: string | null;
}

export interface OfflineActions {
    readonly submit: (values: OfflineValues) => void;
}

export interface OfflineView {
    /** Teks pembuka siap tampil (teks tenant atau bawaan + "Kami kembali …"). */
    readonly intro: string;
    readonly busy: boolean;
    /** Teks galat kiriman terakhir siap tampil, atau null. */
    readonly error: string | null;
    readonly t: (key: MessageKey) => string;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

interface FieldParts {
    readonly control: HTMLInputElement | HTMLTextAreaElement;
    readonly error: HTMLParagraphElement;
    readonly label: HTMLLabelElement;
}

/**
 * Formulir "tinggalkan pesan" saat tim offline (W5b): pesan + email (nama opsional). Dibangun dengan DOM API (tanpa
 * `innerHTML`); validasi di peramban hanya untuk kenyamanan — server memeriksa ulang. Isian tetap ada saat kiriman
 * gagal (pengunjung tak menulis ulang pesannya).
 */
export class OfflineForm {
    public readonly element: HTMLFormElement;

    private readonly intro: HTMLParagraphElement;

    private readonly message: FieldParts;

    private readonly email: FieldParts;

    private readonly name: FieldParts;

    private readonly failure: HTMLParagraphElement;

    private readonly submitButton: HTMLButtonElement;

    private translate: (key: MessageKey) => string = (key) => key;

    private renderedLocale = '';


    public constructor(private readonly doc: Document, private readonly actions: OfflineActions) {
        this.element = this.make('form', 'pw-prechat pw-offline');
        this.element.noValidate = true;
        this.intro = this.make('p', 'pw-offline-intro');
        this.message = this.field('message', this.make('textarea', 'pw-field-input'));
        this.email = this.field('email', this.make('input', 'pw-field-input'));
        this.name = this.field('name', this.make('input', 'pw-field-input'));
        const text = this.message.control as HTMLTextAreaElement;
        text.rows = 3;
        text.maxLength = 4000;
        const email = this.email.control as HTMLInputElement;
        email.type = 'email';
        email.autocomplete = 'email';
        email.maxLength = 254;
        email.setAttribute('aria-required', 'true');
        text.setAttribute('aria-required', 'true');
        const name = this.name.control as HTMLInputElement;
        name.type = 'text';
        name.autocomplete = 'name';
        name.maxLength = 120;
        this.failure = this.make('p', 'pw-prechat-failure');
        this.failure.setAttribute('role', 'alert');
        const buttons = this.make('div', 'pw-prechat-actions');
        this.submitButton = this.make('button', 'pw-prechat-submit');
        this.submitButton.type = 'submit';
        buttons.append(this.submitButton);
        const fields = this.make('div', 'pw-prechat-fields');
        const parts = [this.message, this.email, this.name];
        fields.append(...parts.map((part) => part.control.parentElement ?? part.control));
        this.element.append(this.intro, fields, this.failure, buttons);
        this.element.addEventListener('submit', (event) => {
            event.preventDefault();
            const values = this.validate();
            if (values) {
                this.actions.submit(values);
            }
        });
    }


    public render(view: OfflineView | null): void {
        this.element.hidden = view === null;
        if (!view) {
            return;
        }
        this.translate = view.t;
        this.intro.textContent = view.intro;
        const locale = view.t('offlineSubmit');
        if (locale !== this.renderedLocale) {
            this.renderedLocale = locale;
            this.message.label.textContent = `${view.t('offlineMessageLabel')} *`;
            this.email.label.textContent = `${view.t('offlineEmailLabel')} *`;
            this.name.label.textContent = view.t('offlineNameLabel');
            this.submitButton.textContent = view.t('offlineSubmit');
        }
        this.submitButton.disabled = view.busy;
        this.failure.hidden = view.error === null;
        this.failure.textContent = view.error ?? '';
    }


    /** Kiriman berhasil — isian dikosongkan (formulir berikutnya, mis. setelah shutdown, mulai bersih). */
    public reset(): void {
        for (const part of [this.message, this.email, this.name]) {
            part.control.value = '';
            part.error.hidden = true;
            part.control.setAttribute('aria-invalid', 'false');
        }
    }


    public focus(): void {
        this.message.control.focus();
    }


    private field(key: string, control: HTMLInputElement | HTMLTextAreaElement): FieldParts {
        const wrapper = this.make('div', 'pw-field');
        const id = `pw-offline-${key}`;
        control.id = id;
        const label = this.make('label', 'pw-field-label');
        label.htmlFor = id;
        const error = this.make('p', 'pw-field-error');
        error.id = `${id}-error`;
        error.hidden = true;
        control.setAttribute('aria-describedby', error.id);
        wrapper.append(label, control, error);
        return { control, error, label };
    }


    private validate(): OfflineValues | null {
        const text = this.message.control.value.trim();
        const email = this.email.control.value.trim();
        const name = this.name.control.value.trim();
        const problems: [FieldParts, MessageKey | null][] = [
            [this.message, text ? null : 'prechatRequired'],
            [this.email, !email ? 'prechatRequired' : EMAIL.test(email) ? null : 'prechatInvalidEmail'],
        ];
        let firstInvalid: FieldParts | null = null;
        for (const [part, problem] of problems) {
            part.error.hidden = problem === null;
            part.error.textContent = problem ? this.translate(problem) : '';
            part.control.setAttribute('aria-invalid', String(problem !== null));
            if (problem && !firstInvalid) {
                firstInvalid = part;
            }
        }
        firstInvalid?.control.focus();
        return firstInvalid ? null : { text, email: email.toLowerCase(), name: name || null };
    }


    private make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
        const element = this.doc.createElement(tag);
        element.className = className;
        return element;
    }
}
