import type { MessageKey } from '../i18n';
import type { CustomerSurvey } from '../types';

export interface SurveyActions {
    readonly rate: (score: number) => void;
    readonly comment: (text: string) => void;
}

export interface SurveyView {
    readonly scale: 3 | 5;
    /** Keadaan survei terakhir; null = belum terbaca (server lama) → tombol tetap aktif. */
    readonly survey: CustomerSurvey | null;
    readonly busy: boolean;
    /** Teks galat siap tampil, atau null. */
    readonly error: string | null;
    readonly t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const FACES: Readonly<Record<number, string>> = { 1: '😞', 2: '😐', 3: '😊' };
const FACE_KEYS: Readonly<Record<number, MessageKey>> = { 1: 'surveyFace1', 2: 'surveyFace2', 3: 'surveyFace3' };

function make<K extends keyof HTMLElementTagNameMap>(
    doc: Document,
    tag: K,
    className: string,
): HTMLElementTagNameMap[K] {
    const element = doc.createElement(tag);
    element.className = className;
    return element;
}

/**
 * Kartu penilaian di bawah pesan survei (W5c): tombol skor 1–5 (bintang) atau 1–3 (wajah); setelah dijawab tombol
 * terkunci dengan skor terpilih, lalu kolom komentar opsional selama server mengizinkan (`comment_allowed`).
 * Dibangun ulang setiap kali daftar pesan dirender (keadaannya kecil); tanpa `innerHTML`.
 */
export function surveyCard(doc: Document, view: SurveyView, actions: SurveyActions): HTMLElement {
    const { survey, t } = view;
    const card = make(doc, 'div', 'pw-survey');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', t('surveyTitle'));
    const answered = survey?.status === 'answered';
    const expired = survey?.status === 'expired';
    const row = make(doc, 'div', 'pw-survey-scale');
    for (let score = 1; score <= view.scale; score += 1) {
        const button = make(doc, 'button', 'pw-survey-option');
        button.type = 'button';
        const faceKey = FACE_KEYS[score];
        const label = view.scale === 3 && faceKey ? t(faceKey) : t('surveyScoreLabel', { score, scale: view.scale });
        button.textContent = view.scale === 3 ? FACES[score] ?? String(score) : '★';
        button.setAttribute('aria-label', label);
        button.title = label;
        const selected = answered && survey.score !== null
            && (view.scale === 3 ? survey.score === score : survey.score >= score);
        button.dataset['selected'] = String(selected);
        button.setAttribute('aria-pressed', String(answered && survey.score === score));
        button.disabled = view.busy || answered || expired;
        button.addEventListener('click', () => {
            actions.rate(score);
        });
        row.appendChild(button);
    }
    card.appendChild(row);

    const status = make(doc, 'p', 'pw-survey-status');
    status.setAttribute('aria-live', 'polite');
    if (answered && survey.score !== null) {
        status.textContent = t('surveyThanks', { score: survey.score, scale: survey.scale });
    } else if (expired) {
        status.textContent = t('surveyExpired');
    }
    status.hidden = !status.textContent;
    card.appendChild(status);

    if (answered && survey.comment) {
        const quote = make(doc, 'p', 'pw-survey-comment-sent');
        quote.textContent = `“${survey.comment}”`;
        card.appendChild(quote);
    } else if (answered && survey.comment_allowed) {
        const form = make(doc, 'form', 'pw-survey-comment');
        const label = make(doc, 'label', 'pw-field-label');
        label.htmlFor = 'pw-survey-comment-input';
        label.textContent = t('surveyCommentLabel');
        const input = make(doc, 'textarea', 'pw-field-input');
        input.id = 'pw-survey-comment-input';
        input.rows = 2;
        input.maxLength = 1000;
        const submit = make(doc, 'button', 'pw-prechat-submit');
        submit.type = 'submit';
        submit.textContent = t('surveyCommentSend');
        submit.disabled = view.busy;
        form.append(label, input, submit);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const text = input.value.trim();
            if (text) {
                actions.comment(text);
            }
        });
        card.appendChild(form);
    }

    if (view.error) {
        const error = make(doc, 'p', 'pw-field-error');
        error.setAttribute('role', 'alert');
        error.textContent = view.error;
        card.appendChild(error);
    }
    return card;
}

/** Teks pesan survei tanpa daftar pilihan bernomor ("1) ⭐ 1 … Balas dengan angka") — tombol menggantikannya. */
export function surveyQuestionOf(text: string | null): string {
    return (text ?? '').split(/\n\s*\n/)[0] ?? '';
}
