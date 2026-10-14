import type { MessageKey } from '../i18n';
import type { PrechatField } from '../types';

export type PrechatValues = Record<string, string | boolean>;

export interface PrechatActions {
    readonly submit: (values: PrechatValues) => void;
    readonly skip: () => void;
}

export interface PrechatView {
    readonly fields: readonly PrechatField[];
    readonly optional: boolean;
    readonly consentText: string | null;
    readonly busy: boolean;
    readonly failed: boolean;
    readonly t: (key: MessageKey) => string;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const PHONE = /^\+?[0-9 ()-]{6,32}$/;

type Control = HTMLInputElement | HTMLSelectElement;

interface FieldParts {
    readonly field: PrechatField;
    readonly control: Control;
    readonly error: HTMLParagraphElement;
}

/**
 * Formulir pre-chat (W4b) — dibangun dari `config.prechat.fields` dengan DOM API (tanpa `innerHTML`). Validasi di
 * peramban hanya untuk kenyamanan; server memeriksa ulang terhadap konfigurasi widget yang sama.
 */
export class PrechatForm {
    public readonly element: HTMLFormElement;

    private parts: FieldParts[] = [];

    private renderedKey = '';

    private readonly heading: HTMLParagraphElement;

    private readonly body: HTMLDivElement;

    private readonly failure: HTMLParagraphElement;

    private readonly submitButton: HTMLButtonElement;

    private readonly skipButton: HTMLButtonElement;

    private translate: (key: MessageKey) => string = (key) => key;


    public constructor(private readonly doc: Document, private readonly actions: PrechatActions) {
        this.element = this.make('form', 'pw-prechat');
        this.element.noValidate = true;
        this.heading = this.make('p', 'pw-prechat-title');
        this.body = this.make('div', 'pw-prechat-fields');
        this.failure = this.make('p', 'pw-prechat-failure');
        this.failure.setAttribute('role', 'alert');
        const buttons = this.make('div', 'pw-prechat-actions');
        this.skipButton = this.make('button', 'pw-prechat-skip');
        this.skipButton.type = 'button';
        this.submitButton = this.make('button', 'pw-prechat-submit');
        this.submitButton.type = 'submit';
        buttons.append(this.skipButton, this.submitButton);
        this.element.append(this.heading, this.body, this.failure, buttons);
        this.element.addEventListener('submit', (event) => {
            event.preventDefault();
            const values = this.validate();
            if (values) {
                this.actions.submit(values);
            }
        });
        this.skipButton.addEventListener('click', () => {
            this.actions.skip();
        });
    }


    public render(view: PrechatView | null): void {
        this.element.hidden = view === null;
        if (!view) {
            return;
        }
        this.translate = view.t;
        const key = JSON.stringify([view.fields, view.consentText, view.t('prechatTitle')]);
        if (key !== this.renderedKey) {
            this.renderedKey = key;
            this.build(view);
        }
        this.skipButton.hidden = !view.optional;
        this.skipButton.textContent = view.t('prechatSkip');
        this.submitButton.textContent = view.t('prechatSubmit');
        this.submitButton.disabled = view.busy;
        this.failure.hidden = !view.failed;
        this.failure.textContent = view.failed ? view.t('prechatFailed') : '';
    }


    private build(view: PrechatView): void {
        this.heading.textContent = view.t('prechatTitle');
        this.parts = view.fields.map((field) => this.fieldParts(field, view));
        this.body.replaceChildren(...this.parts.map((part) => part.control.closest('.pw-field') ?? part.control));
    }


    private fieldParts(field: PrechatField, view: PrechatView): FieldParts {
        const wrapper = this.make('div', 'pw-field');
        const id = `pw-prechat-${field.key}`;
        const error = this.make('p', 'pw-field-error');
        error.id = `${id}-error`;
        error.hidden = true;
        const control = this.controlOf(field, view);
        control.id = id;
        control.setAttribute('aria-describedby', error.id);
        if (field.required) {
            control.setAttribute('aria-required', 'true');
        }

        const label = this.make('label', 'pw-field-label');
        label.htmlFor = id;
        label.textContent = field.type === 'consent' ? view.consentText ?? field.label : field.label;
        if (field.required && field.type !== 'consent') {
            label.append(' *');
        }
        if (field.type === 'consent') {
            wrapper.classList.add('pw-field-consent');
            wrapper.append(control, label, error);
        } else {
            wrapper.append(label, control, error);
        }
        return { field, control, error };
    }


    private controlOf(field: PrechatField, view: PrechatView): Control {
        if (field.type === 'select') {
            const select = this.make('select', 'pw-field-input');
            const placeholder = this.doc.createElement('option');
            placeholder.value = '';
            placeholder.textContent = view.t('prechatChoose');
            select.append(placeholder, ...(field.options ?? []).map((option) => {
                const element = this.doc.createElement('option');
                element.value = option.value;
                element.textContent = option.label;
                return element;
            }));
            return select;
        }
        const input = this.make('input', field.type === 'consent' ? 'pw-field-check' : 'pw-field-input');
        input.name = field.key;
        if (field.type === 'consent') {
            input.type = 'checkbox';
            return input;
        }
        input.type = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text';
        input.maxLength = field.type === 'phone' ? 32 : 200;
        const autocomplete: Partial<Record<string, string>> = { name: 'name', email: 'email', phone: 'tel' };
        input.autocomplete = (autocomplete[field.key] ?? (field.type === 'text' ? 'off' : autocomplete[field.type])) as AutoFill;
        return input;
    }


    /** Nilai siap kirim, atau null bila ada yang salah (pesan di bawah field; fokus ke yang pertama). */
    private validate(): PrechatValues | null {
        const values: PrechatValues = {};
        let firstInvalid: Control | null = null;
        for (const { field, control, error } of this.parts) {
            const problem = this.problemOf(field, control);
            error.hidden = problem === null;
            error.textContent = problem ? this.translate(problem) : '';
            control.setAttribute('aria-invalid', String(problem !== null));
            if (problem && !firstInvalid) {
                firstInvalid = control;
            }
            const value = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value.trim();
            if (value !== '' && value !== false) {
                values[field.key] = value;
            }
        }
        firstInvalid?.focus();
        return firstInvalid ? null : values;
    }


    private problemOf(field: PrechatField, control: Control): MessageKey | null {
        if (field.type === 'consent') {
            return field.required && control instanceof HTMLInputElement && !control.checked ? 'prechatConsentRequired' : null;
        }
        const value = control.value.trim();
        if (!value) {
            return field.required ? 'prechatRequired' : null;
        }
        if (field.type === 'email' && !EMAIL.test(value)) {
            return 'prechatInvalidEmail';
        }
        if (field.type === 'phone' && !PHONE.test(value)) {
            return 'prechatInvalidPhone';
        }
        return null;
    }


    private make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
        const element = this.doc.createElement(tag);
        element.className = className;
        return element;
    }
}
