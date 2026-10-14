import type { ConversationPage, OtpRequestResult, PageInfo, PrechatResult, SendResult, Session, WidgetConfig } from './types';

/**
 * Galat API publik dengan kode stabil (`error_code` server) — teks untuk pengunjung dipilih dari kode, bukan dari
 * pesan server.
 */
export class ApiError extends Error {
    public constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly retryAfterSeconds: number | null = null,
        public readonly details: Readonly<Record<string, unknown>> | null = null,
    ) {
        super(message);
        this.name = 'ApiError';
    }


    /** Gagal karena jaringan/server sementara — layak dicoba ulang tanpa campur tangan pengunjung. */
    public get transient(): boolean {
        return this.code === 'network' || this.status >= 500 || this.status === 429;
    }
}

interface Envelope<T> {
    readonly success?: boolean;
    readonly data?: T;
    readonly message?: string;
    readonly error_code?: string;
    readonly retry_after_seconds?: number;
    readonly details?: Record<string, unknown>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BootBody {
    readonly widget_id: string;
    readonly refresh_token?: string;
    readonly page_origin?: string;
    readonly page?: PageInfo & { readonly referrer?: string };
    readonly locale?: string;
    readonly captcha_token?: string;
}

export interface PrechatBody {
    readonly fields: Readonly<Record<string, string | boolean>>;
    readonly consent_version?: string;
}

/** Klien REST `/webchat/v1` (origin sama dengan dokumen iframe → tanpa CORS, tanpa cookie). */
export class PublicApi {
    public constructor(private readonly baseUrl: string, private readonly fetcher: FetchLike) {}


    public config(widgetId: string): Promise<WidgetConfig> {
        return this.request('GET', `/widgets/${encodeURIComponent(widgetId)}/config`);
    }


    public boot(body: BootBody): Promise<Session> {
        return this.request('POST', '/sessions', { body });
    }


    public refresh(widgetId: string, refreshToken: string): Promise<Session> {
        return this.request('POST', '/sessions/refresh', { body: { widget_id: widgetId, refresh_token: refreshToken } });
    }


    /** Naikkan sesi ke `verified` dengan identity token dari server website; refresh token ikut dirotasi. */
    public identify(token: string, identityToken: string): Promise<Session> {
        return this.request('POST', '/sessions/identify', { token, body: { identity_token: identityToken } });
    }


    /** Formulir pre-chat (W4b): isian + persetujuan → kontak diisi (tanpa penggabungan), sesi `contact_provided`. */
    public prechat(token: string, body: PrechatBody): Promise<PrechatResult> {
        return this.request('POST', '/prechat', { token, body });
    }


    /** Kode verifikasi ke email (W4c). Jawaban sama untuk alamat apa pun. */
    public requestOtp(token: string, email: string): Promise<OtpRequestResult> {
        return this.request('POST', '/otp/request', { token, body: { email } });
    }


    /** Email + kode → sesi `verified`; refresh token ikut dirotasi. */
    public verifyOtp(token: string, email: string, code: string): Promise<Session> {
        return this.request('POST', '/otp/verify', { token, body: { email, code } });
    }


    public shutdown(token: string): Promise<unknown> {
        return this.request('POST', '/sessions/shutdown', { token });
    }


    public send(
        token: string,
        body: { client_message_id: string; text: string; page?: PageInfo },
    ): Promise<SendResult> {
        return this.request('POST', '/messages', { token, body });
    }


    public conversation(token: string): Promise<ConversationPage> {
        return this.request('GET', '/conversation', { token });
    }


    public messagesAfter(token: string, after: string): Promise<ConversationPage> {
        return this.request('GET', `/conversation/messages?after=${encodeURIComponent(after)}&limit=50`, { token });
    }


    public messagesBefore(token: string, before: string): Promise<ConversationPage> {
        return this.request('GET', `/conversation/messages?before=${encodeURIComponent(before)}&limit=30`, { token });
    }


    public markRead(token: string): Promise<unknown> {
        return this.request('POST', '/conversation/read', { token, body: {} });
    }


    private async request<T>(
        method: string,
        path: string,
        options: { token?: string; body?: unknown } = {},
    ): Promise<T> {
        let response: Response;
        try {
            response = await this.fetcher(`${this.baseUrl}/webchat/v1${path}`, {
                method,
                headers: {
                    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
                    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
                },
                ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
                credentials: 'omit',
            });
        } catch (error) {
            throw new ApiError(0, 'network', error instanceof Error ? error.message : 'network error');
        }

        const envelope = await response.json().catch(() => ({})) as Envelope<T>;
        if (!response.ok || envelope.data === undefined) {
            const retryHeader = Number(response.headers.get('retry-after'));
            const headerSeconds = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null;
            const retryAfter = envelope.retry_after_seconds ?? headerSeconds;
            throw new ApiError(
                response.status,
                envelope.error_code ?? 'unknown',
                envelope.message ?? `HTTP ${String(response.status)}`,
                retryAfter,
                envelope.details ?? null,
            );
        }
        return envelope.data;
    }
}
