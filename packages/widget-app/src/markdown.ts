/**
 * Perender MARKDOWN SUBSET yang aman untuk balasan agen/AI (dialek `markdown` penyedia webchat, api-crm W2d):
 * **tebal**, *miring* / _miring_, `kode`, [teks](https://…), URL telanjang, dan baris baru. Tak ada HTML: setiap
 * keluaran adalah node DOM yang dibangun `createElement` / `createTextNode`; teks pesan TIDAK PERNAH masuk
 * `innerHTML`. Tautan hanya `https:`, `http:`, dan `mailto:` — dibuka di tab baru tanpa akses ke jendela ini.
 */

const SAFE_PROTOCOLS = ['https:', 'http:', 'mailto:'];

type Token =
    | { readonly kind: 'text'; readonly value: string }
    | { readonly kind: 'strong' | 'em' | 'code'; readonly value: string }
    | { readonly kind: 'link'; readonly value: string; readonly href: string };

// Tanpa lookbehind: iOS Safari 15 (didukung) belum mengenalnya — regex seperti itu = galat sintaks seluruh skrip.
// Karakter SEBELUM penanda miring ditangkap (grup prefiks) lalu dikembalikan sebagai teks biasa.
const PATTERN = new RegExp([
    '\\*\\*([^*\\n]+)\\*\\*',
    '`([^`\\n]+)`',
    '\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)',
    '(^|[^\\w*])\\*([^*\\n]+)\\*(?=$|[^\\w*])',
    '(^|[^\\w])_([^_\\n]+)_(?=$|\\W)',
    '(https?:\\/\\/[^\\s<>()]+[^\\s<>().,!?;:\'"])',
].join('|'), 'g');

export function safeHref(raw: string): string | null {
    try {
        const url = new URL(raw);
        return SAFE_PROTOCOLS.includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

export function tokenize(line: string): Token[] {
    const tokens: Token[] = [];
    let last = 0;
    for (const match of line.matchAll(PATTERN)) {
        const index = match.index;
        if (index > last) {
            tokens.push({ kind: 'text', value: line.slice(last, index) });
        }
        const [whole, strong, code, linkText, linkHref, emPrefix, em, underscorePrefix, emUnderscore, bareUrl] = match;
        const prefix = emPrefix ?? underscorePrefix ?? '';
        if (prefix) {
            tokens.push({ kind: 'text', value: prefix });
        }
        if (strong !== undefined) {
            tokens.push({ kind: 'strong', value: strong });
        } else if (code !== undefined) {
            tokens.push({ kind: 'code', value: code });
        } else if (linkText !== undefined && linkHref !== undefined) {
            const href = safeHref(linkHref);
            tokens.push(href ? { kind: 'link', value: linkText, href } : { kind: 'text', value: whole });
        } else if (em !== undefined || emUnderscore !== undefined) {
            tokens.push({ kind: 'em', value: em ?? emUnderscore ?? '' });
        } else if (bareUrl !== undefined) {
            const href = safeHref(bareUrl);
            tokens.push(href ? { kind: 'link', value: bareUrl, href } : { kind: 'text', value: bareUrl });
        }
        last = index + whole.length;
    }
    if (last < line.length) {
        tokens.push({ kind: 'text', value: line.slice(last) });
    }
    return tokens;
}

function nodeOf(doc: Document, token: Token): Node {
    switch (token.kind) {
        case 'text':
            return doc.createTextNode(token.value);
        case 'strong':
        case 'em':
        case 'code': {
            const element = doc.createElement(token.kind);
            element.textContent = token.value;
            return element;
        }
        case 'link': {
            const anchor = doc.createElement('a');
            anchor.href = token.href;
            anchor.textContent = token.value;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer nofollow';
            return anchor;
        }
    }
}

/** Isi pesan sebagai fragmen DOM aman. */
export function renderMarkdown(doc: Document, text: string): DocumentFragment {
    const fragment = doc.createDocumentFragment();
    text.split('\n').forEach((line, index) => {
        if (index > 0) {
            fragment.appendChild(doc.createElement('br'));
        }
        for (const token of tokenize(line)) {
            fragment.appendChild(nodeOf(doc, token));
        }
    });
    return fragment;
}
