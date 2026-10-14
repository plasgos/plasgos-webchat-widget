import type { ChatMessage, Locale, WidgetConfig } from './types';

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
};

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
