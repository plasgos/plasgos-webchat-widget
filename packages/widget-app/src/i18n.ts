import type { Locale } from './types';

const DICTIONARY = {
    id: {
        openChat: 'Buka chat',
        closeChat: 'Tutup chat',
        chatWindow: 'Jendela chat',
        defaultTitle: 'Chat',
        inputPlaceholder: 'Tulis pesan…',
        send: 'Kirim',
        typing: 'Tim sedang mengetik…',
        sending: 'Mengirim…',
        sent: 'Terkirim',
        delivered: 'Sampai',
        read: 'Dibaca',
        failed: 'Gagal terkirim — ketuk untuk mencoba lagi',
        retry: 'Coba lagi',
        offline: 'Koneksi terputus. Pesan akan dikirim saat tersambung kembali.',
        reconnecting: 'Menyambung kembali…',
        unreadBadge: '{count} pesan belum dibaca',
        soundOn: 'Nyalakan suara notifikasi',
        soundOff: 'Matikan suara notifikasi',
        verifyHuman: 'Selesaikan verifikasi singkat untuk mulai chat.',
        identityRequired: 'Masuk ke akun Anda di website ini untuk mulai chat.',
        agent: 'Tim',
        bot: 'Asisten',
        you: 'Anda',
        newMessages: 'Pesan baru',
        error_widget_unavailable: 'Chat tidak tersedia saat ini.',
        error_origin_not_allowed: 'Chat tidak tersedia di halaman ini.',
        error_rate_limited: 'Terlalu banyak permintaan. Coba lagi dalam {seconds} detik.',
        error_captcha_required: 'Selesaikan verifikasi singkat untuk mulai chat.',
        error_captcha_invalid: 'Verifikasi tidak berhasil. Coba lagi.',
        error_session_revoked: 'Sesi chat berakhir. Muat ulang halaman untuk mulai lagi.',
        error_visitor_blocked: 'Pesan tidak dapat dikirim.',
        error_webchat_unavailable: 'Layanan chat sedang tidak tersedia.',
        error_conversation_limit_reached: 'Layanan chat sedang sibuk. Coba lagi beberapa saat lagi.',
        error_identity_required: 'Masuk ke akun Anda di website ini untuk mulai chat.',
        error_network: 'Tidak dapat terhubung. Periksa koneksi internet Anda.',
        error_unknown: 'Terjadi kesalahan. Coba lagi.',
    },
    en: {
        openChat: 'Open chat',
        closeChat: 'Close chat',
        chatWindow: 'Chat window',
        defaultTitle: 'Chat',
        inputPlaceholder: 'Write a message…',
        send: 'Send',
        typing: 'The team is typing…',
        sending: 'Sending…',
        sent: 'Sent',
        delivered: 'Delivered',
        read: 'Read',
        failed: 'Not sent — tap to retry',
        retry: 'Retry',
        offline: 'Connection lost. Messages will be sent once you are back online.',
        reconnecting: 'Reconnecting…',
        unreadBadge: '{count} unread messages',
        soundOn: 'Turn notification sound on',
        soundOff: 'Turn notification sound off',
        verifyHuman: 'Complete a quick check to start chatting.',
        identityRequired: 'Sign in to your account on this website to start chatting.',
        agent: 'Team',
        bot: 'Assistant',
        you: 'You',
        newMessages: 'New messages',
        error_widget_unavailable: 'Chat is not available right now.',
        error_origin_not_allowed: 'Chat is not available on this page.',
        error_rate_limited: 'Too many requests. Try again in {seconds} seconds.',
        error_captcha_required: 'Complete a quick check to start chatting.',
        error_captcha_invalid: 'Verification failed. Please try again.',
        error_session_revoked: 'Your chat session has ended. Reload the page to start again.',
        error_visitor_blocked: 'Messages cannot be sent.',
        error_webchat_unavailable: 'The chat service is temporarily unavailable.',
        error_conversation_limit_reached: 'The chat service is busy. Please try again shortly.',
        error_identity_required: 'Sign in to your account on this website to start chatting.',
        error_network: 'Cannot connect. Check your internet connection.',
        error_unknown: 'Something went wrong. Please try again.',
    },
} as const;

export type MessageKey = keyof (typeof DICTIONARY)['id'];

type Vars = Readonly<Record<string, string | number>>;

export function translate(locale: Locale, key: MessageKey, vars: Vars = {}): string {
    const template: string = DICTIONARY[locale][key];
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Teks galat untuk kode dari API publik; kode tak dikenal → teks umum (tak pernah teks mentah server). */
export function errorText(locale: Locale, code: string | null, vars: Vars = {}): string {
    const key = `error_${code ?? 'unknown'}`;
    return key in DICTIONARY[locale] ? translate(locale, key as MessageKey, vars) : translate(locale, 'error_unknown');
}

export function resolveLocale(preferred: string | undefined, fallback: Locale): Locale {
    return preferred === 'id' || preferred === 'en' ? preferred : fallback;
}
