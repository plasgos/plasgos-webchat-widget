import type { AvailabilityStatus, ChatMessage, ConversationStatus, CustomerSurvey, Locale, WidgetConfig } from './types';

/** Urutan status pesan; status TAK PERNAH mundur (read tak diturunkan delivered yang datang terlambat). */
const STATUS_RANK: Readonly<Record<string, number>> = {
    failed: 0,
    pending: 1,
    accepted: 2,
    sent: 2,
    unread: 3,
    delivered: 3,
    read: 4,
};

export type Connection = 'idle' | 'connecting' | 'online' | 'offline';

export interface Notice {
    readonly code: string;
    readonly vars?: Readonly<Record<string, string | number>>;
    /** true = widget tak bisa dipakai sampai dimuat ulang (mis. sesi dicabut). */
    readonly fatal: boolean;
}

export interface AppState {
    readonly locale: Locale;
    readonly config: WidgetConfig | null;
    readonly open: boolean;
    readonly visible: boolean;
    readonly messages: readonly ChatMessage[];
    readonly unread: number;
    readonly agentTypingUntil: number;
    readonly connection: Connection;
    readonly notice: Notice | null;
    readonly captchaSiteKey: string | null;
    readonly soundEnabled: boolean;
    readonly trustLevel: string | null;
    readonly conversationId: string | null;
    /** Formulir pre-chat ditampilkan (belum dikirim / dilewati, pengunjung belum terverifikasi). */
    readonly prechatPending: boolean;
    readonly prechatBusy: boolean;
    /** Kode galat kiriman formulir terakhir (ditampilkan di formulir), atau null. */
    readonly prechatError: string | null;
    /** Panel verifikasi email (W4c): null = tertutup. */
    readonly otp: OtpState | null;
    /** Ada agen siap melayani: true/false; null = tak diketahui (tak ditampilkan). */
    readonly teamOnline: boolean | null;
    /** Jam kerja (W5b): false = di luar jam kerja; diperbarui berkala dari konfigurasi. */
    readonly hoursOpen: boolean;
    readonly nextOpenAt: string | null;
    readonly hoursTimezone: string | null;
    readonly replyEstimateMinutes: number | null;
    /** Alamat balasan pengunjung sudah diketahui — formulir offline tak perlu ditampilkan. */
    readonly emailOnFile: boolean;
    readonly offlineBusy: boolean;
    /** Kode galat kiriman formulir offline terakhir, atau null. */
    readonly offlineError: string | null;
    /** Tim menandai percakapan selesai (W5c) — pengunjung tetap bisa menulis (membuka lagi). */
    readonly conversationStatus: ConversationStatus;
    /** Survei kepuasan terakhir (kartu penilaian), atau null. */
    readonly survey: CustomerSurvey | null;
    readonly surveyBusy: boolean;
    /** Kode galat kiriman penilaian terakhir, atau null. */
    readonly surveyError: string | null;
    /** Panel transkrip: null = tertutup. */
    readonly transcript: TranscriptState | null;
}

export interface TranscriptState {
    readonly busy: boolean;
    readonly sent: boolean;
    readonly error: string | null;
}

export interface OtpState {
    readonly step: 'email' | 'code';
    readonly email: string;
    readonly busy: boolean;
    readonly error: { readonly code: string; readonly vars?: Readonly<Record<string, string | number>> } | null;
}

export const INITIAL_STATE: AppState = {
    locale: 'id',
    config: null,
    open: false,
    visible: true,
    messages: [],
    unread: 0,
    agentTypingUntil: 0,
    connection: 'idle',
    notice: null,
    captchaSiteKey: null,
    soundEnabled: true,
    trustLevel: null,
    conversationId: null,
    prechatPending: false,
    prechatBusy: false,
    prechatError: null,
    otp: null,
    teamOnline: null,
    hoursOpen: true,
    nextOpenAt: null,
    hoursTimezone: null,
    replyEstimateMinutes: null,
    emailOnFile: false,
    offlineBusy: false,
    offlineError: null,
    conversationStatus: 'open',
    survey: null,
    surveyBusy: false,
    surveyError: null,
    transcript: null,
};

/**
 * Ketersediaan saat ini: di luar jam kerja → `closed`; jam kerja tanpa agen daring → `away`; selain itu `open`
 * (status tim tak diketahui = dianggap buka — chat tak pernah tertutup karena data presence hilang).
 */
export function availabilityOf(state: AppState): AvailabilityStatus {
    if (!state.hoursOpen) {
        return 'closed';
    }
    return state.teamOnline === false ? 'away' : 'open';
}

/** Formulir "tinggalkan pesan" (W5b): tim tak `open`, mode bukan `hidden`, alamat balasan belum diketahui. */
export function needsOfflineForm(state: AppState): boolean {
    const mode = state.config?.offline?.mode ?? 'form';
    return availabilityOf(state) !== 'open' && mode !== 'hidden' && !state.emailOnFile
        && state.config?.availability !== undefined && state.config.availability !== null;
}

function rank(status: string | null): number {
    return status === null ? 0 : STATUS_RANK[status] ?? 0;
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
    if (a.id !== null && b.id !== null && a.id === b.id) {
        return true;
    }

    return a.direction === 'inbound' && b.direction === 'inbound'
        && a.client_message_id !== null && a.client_message_id === b.client_message_id;
}

function merge(current: ChatMessage, incoming: ChatMessage): ChatMessage {
    // Pesan yang sudah gagal dikirim boleh hidup lagi (kirim ulang) — selain itu status hanya maju.
    const status = current.status === 'failed' || rank(incoming.status) >= rank(current.status) ? incoming.status : current.status;
    return { ...current, ...incoming, id: incoming.id ?? current.id, status, timestamp: current.timestamp };
}

/** Gabungkan pesan (riwayat, socket, optimistis, tab lain) — tanpa duplikat, urut waktu. */
export function upsertMessages(list: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
    const next = [...list];
    for (const message of incoming) {
        const index = next.findIndex((existing) => sameMessage(existing, message));
        if (index === -1) {
            next.push(message);
        } else {
            next[index] = merge(next[index] as ChatMessage, message);
        }
    }
    return next.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Status pesan pengunjung (inbound): satu pesan (id/client id) atau "sampai waktu ini" (`upToAt`). */
export function applyInboundStatus(
    list: readonly ChatMessage[],
    update: {
        readonly messageId: string | null;
        readonly clientMessageId: string | null;
        readonly status: string;
        readonly upToAt: string | null;
    },
): ChatMessage[] {
    return list.map((message) => {
        if (message.direction !== 'inbound') {
            return message;
        }

        const hit = update.messageId !== null || update.clientMessageId !== null
            ? (update.messageId !== null && message.id === update.messageId)
                || (update.clientMessageId !== null && message.client_message_id === update.clientMessageId)
            : update.upToAt !== null && message.timestamp <= update.upToAt;
        if (!hit || rank(update.status) < rank(message.status)) {
            return message;
        }

        return { ...message, status: update.status, id: message.id ?? update.messageId };
    });
}

/** Waktu pesan terakhir yang SUDAH tersimpan di server (bukan optimistis) — kursor `after` setelah sambung ulang. */
export function lastServerTimestamp(list: readonly ChatMessage[]): string | null {
    for (let index = list.length - 1; index >= 0; index -= 1) {
        const message = list[index] as ChatMessage;
        if (message.id !== null && message.status !== 'pending' && message.status !== 'failed') {
            return message.timestamp;
        }
    }
    return null;
}

export type Listener = (state: AppState) => void;

/** Penampung keadaan tunggal; setiap perubahan memanggil pendengar (perender) sekali. */
export class Store {
    private state: AppState;

    private readonly listeners = new Set<Listener>();


    public constructor(initial: AppState = INITIAL_STATE) {
        this.state = initial;
    }


    public get(): AppState {
        return this.state;
    }


    public update(patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)): void {
        const change = typeof patch === 'function' ? patch(this.state) : patch;
        this.state = { ...this.state, ...change };
        for (const listener of this.listeners) {
            listener(this.state);
        }
    }


    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}
