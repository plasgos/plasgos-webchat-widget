import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import type { ChatMessage } from './types';

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

/** Penolakan yang tak akan berubah dengan mencoba lagi. */
const PERMANENT_REJECTIONS = ['session_revoked', 'visitor_blocked', 'widget_unavailable', 'webchat_unavailable'];
const TOKEN_REJECTIONS = ['token_expired', 'token_invalid', 'token_missing'];

/**
 * Koneksi realtime pengunjung. `auth` berupa FUNGSI: setiap (sambung ulang) membaca token akses terbaru, sehingga
 * rotasi token tak memerlukan pembuatan socket baru.
 */
export class Realtime {
    private socket: Socket<ServerEvents, ClientEvents> | null = null;

    private everConnected = false;


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
            }
        });
        for (const name of ['message.created', 'message.status', 'typing', 'session.refresh_required', 'session.revoked'] as const) {
            socket.on(name, ((payload: never) => {
                this.handlers.onEvent(name, payload);
            }) as never);
        }
        this.socket = socket;
    }


    public reconnect(): void {
        this.socket?.disconnect();
        this.socket?.connect();
    }


    public disconnect(): void {
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
}
