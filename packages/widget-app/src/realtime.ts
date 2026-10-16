import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import type { ChatMessage, ConversationStatus, CustomerSurvey, ProactiveMessage } from './types';

/** Event server → widget di namespace `/webchat` (api-crm WEBCHAT_DESIGN.md §8). */
export interface ServerEvents {
    'message.created': (payload: { conversation_id: string; message: ChatMessage }) => void;
    'message.status': (payload: {
        conversation_id: string | null;
        direction: 'inbound' | 'outbound';
        message_id: string | null;
        client_message_id: string | null;
        status: string;
        up_to_at: string | null;
    }) => void;
    typing: (payload: { conversation_id: string; typing: boolean; expires_at: string | null }) => void;
    'session.refresh_required': (payload: { reason: string; expires_at: string }) => void;
    'session.revoked': (payload: { reason: string }) => void;
    /** Ada agen siap melayani (W5a); `online: null` = tak diketahui. */
    'team.presence': (payload: { online: boolean | null; at: string }) => void;
    /** Tim menandai percakapan selesai / pengunjung atau agen membukanya lagi (W5c). */
    'conversation.state': (payload: { conversation_id: string; status: ConversationStatus; resolved_at: string | null }) => void;
    /** Survei kepuasan dikirim / dijawab (semua tab pengunjung, W5c). */
    'csat.updated': (payload: { conversation_id: string; survey: CustomerSurvey | null }) => void;
    /** Percakapan diteruskan ke tim — dari tombol pengunjung atau batas AI tercapai (W6c). */
    'conversation.handoff': (payload: { conversation_id: string; active: boolean; reason: string; at: string }) => void;
    /** Agen menyapa pengunjung yang sedang di website (pesan proaktif manual, W8b). */
    'proactive.message': (payload: { message: ProactiveMessage }) => void;
    /** Pesan WhatsApp berkode masuk — percakapan tersambung ke nomor itu (W8d). */
    'whatsapp.linked': (payload: { phone_masked: string | null; at: string }) => void;
}

/** Event widget → server; balasan lewat ack. */
export interface ClientEvents {
    typing: (payload: { typing: boolean }, ack: (result: { ok: boolean }) => void) => void;
    delivered: (payload: { up_to?: string }, ack: (result: { ok: boolean }) => void) => void;
    read: (payload: { up_to?: string }, ack: (result: { ok: boolean }) => void) => void;
}

export interface RealtimeHandlers {
    readonly onEvent: <K extends keyof ServerEvents>(name: K, payload: Parameters<ServerEvents[K]>[0]) => void;
    readonly onConnected: (reconnected: boolean) => void;
    readonly onDisconnected: () => void;
    /** Penolakan sambung: alasan dari server (`connect_error.data.reason`). */
    readonly onRejected: (reason: string) => void;
    /** Token habis / server minta refresh: perbarui token, lalu panggil `reconnect()`. */
    readonly onTokenStale: () => void;
}

interface SpacedEvent {
    lastSentAt: number;
    timer: ReturnType<typeof setTimeout> | null;
    payload: unknown;
}

/** Penolakan yang tak akan berubah dengan mencoba lagi. */
const PERMANENT_REJECTIONS = ['session_revoked', 'visitor_blocked', 'widget_unavailable', 'webchat_unavailable'];
const TOKEN_REJECTIONS = ['token_expired', 'token_invalid', 'token_missing'];
/** Jeda sambung ulang setelah penolakan lain (batas laju, gangguan server) — socket.io tak menyambung sendiri. */
const REJECTION_RETRY_MS = [2000, 5000, 15000, 30000];
/** Server menolak `delivered`/`read` yang datang < 1 dtk setelah sebelumnya (`throttled`) — dikirim di ujung jeda. */
const CLIENT_EVENT_SPACING_MS = 1100;

/**
 * Koneksi realtime pengunjung. `auth` berupa FUNGSI: setiap (sambung ulang) membaca token akses terbaru, sehingga
 * rotasi token tak memerlukan pembuatan socket baru.
 */
export class Realtime {
    private socket: Socket<ServerEvents, ClientEvents> | null = null;

    private everConnected = false;

    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    private retryAttempt = 0;

    private readonly spaced = new Map<string, SpacedEvent>();


    public constructor(
        private readonly origin: string,
        private readonly token: () => string | null,
        private readonly handlers: RealtimeHandlers,
    ) {}


    public connect(): void {
        if (this.socket) {
            this.socket.connect();
            return;
        }

        const socket: Socket<ServerEvents, ClientEvents> = io(`${this.origin}/webchat`, {
            auth: (callback) => {
                callback({ token: this.token() });
            },
            transports: ['websocket', 'polling'],
            reconnectionDelay: 1000,
            reconnectionDelayMax: 15000,
            withCredentials: false,
        });
        socket.on('connect', () => {
            this.retryAttempt = 0;
            this.handlers.onConnected(this.everConnected);
            this.everConnected = true;
        });
        socket.on('disconnect', (reason) => {
            this.handlers.onDisconnected();
            // Server memutus (token habis / sesi dicabut) → socket.io TIDAK menyambung sendiri.
            if (reason === 'io server disconnect') {
                this.handlers.onTokenStale();
            }
        });
        socket.on('connect_error', (error: Error & { data?: { reason?: string } }) => {
            const reason = error.data?.reason ?? null;
            if (reason && PERMANENT_REJECTIONS.includes(reason)) {
                socket.disconnect();
                this.handlers.onRejected(reason);
            } else if (reason && TOKEN_REJECTIONS.includes(reason)) {
                socket.disconnect();
                this.handlers.onTokenStale();
            } else if (!socket.active) {
                // Ditolak middleware dengan alasan lain (`rate_limited`, `auth_unavailable`, …): socket.io
                // menghancurkan
                // socket tanpa menyambung ulang — dulu balasan tak pernah tiba sampai halaman dimuat ulang.
                const retryAfter = Number((error.data as { retry_after?: unknown } | undefined)?.retry_after);
                this.scheduleRetry(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null);
            }
        });
        const events = [
            'message.created', 'message.status', 'typing', 'session.refresh_required', 'session.revoked', 'team.presence',
            'conversation.state', 'csat.updated', 'conversation.handoff', 'proactive.message', 'whatsapp.linked',
        ] as const;
        for (const name of events) {
            socket.on(name, ((payload: never) => {
                this.handlers.onEvent(name, payload);
            }) as never);
        }
        this.socket = socket;
    }


    public reconnect(): void {
        this.clearRetry();
        this.socket?.disconnect();
        this.socket?.connect();
    }


    public disconnect(): void {
        this.clearRetry();
        for (const entry of this.spaced.values()) {
            if (entry.timer !== null) {
                clearTimeout(entry.timer);
            }
        }
        this.spaced.clear();
        this.socket?.disconnect();
    }


    public get connected(): boolean {
        return this.socket?.connected ?? false;
    }


    public emit<K extends keyof ClientEvents>(name: K, payload: Parameters<ClientEvents[K]>[0]): void {
        if (!this.socket?.connected) {
            return;
        }
        (this.socket.emit as (event: string, data: unknown, ack: () => void) => void)(name, payload, () => undefined);
    }


    /**
     * Sinyal yang dijarangkan server (`delivered`, `read`: 1×/dtk): dikirim segera bila jedanya cukup, selain itu
     * SEKALI di ujung jeda dengan muatan terbaru — dulu sinyal kedua dibuang server sehingga pesan terakhir tetap
     * "belum dibaca".
     */
    public emitSpaced<K extends keyof ClientEvents>(
        name: K,
        payload: Parameters<ClientEvents[K]>[0],
        now = Date.now(),
    ): void {
        const entry = this.spaced.get(name) ?? { lastSentAt: 0, timer: null, payload: null };
        this.spaced.set(name, entry);
        entry.payload = payload;
        if (entry.timer !== null) {
            return;
        }
        const wait = entry.lastSentAt + CLIENT_EVENT_SPACING_MS - now;
        const fire = (): void => {
            entry.timer = null;
            entry.lastSentAt = Date.now();
            this.emit(name, entry.payload as Parameters<ClientEvents[K]>[0]);
        };
        if (wait <= 0) {
            fire();
        } else {
            entry.timer = setTimeout(fire, wait);
        }
    }


    private scheduleRetry(afterMs: number | null): void {
        if (this.retryTimer !== null) {
            return;
        }
        const step = REJECTION_RETRY_MS[Math.min(this.retryAttempt, REJECTION_RETRY_MS.length - 1)] ?? 30000;
        this.retryAttempt += 1;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.socket?.connect();
        }, Math.max(afterMs ?? 0, step));
    }


    private clearRetry(): void {
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }
}
