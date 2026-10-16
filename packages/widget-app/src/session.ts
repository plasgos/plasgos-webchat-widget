import { ApiError } from './api';
import type { BootBody, PublicApi } from './api';
import type { KeyValueStore } from './storage';
import type { TabChannel } from './tabs';
import type { Session } from './types';

/** Refresh dilakukan bila token akses tinggal kurang dari ini. */
const REFRESH_MARGIN_MS = 60_000;

interface LockManagerLike {
    request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

export interface SessionDependencies {
    readonly api: PublicApi;
    readonly storage: KeyValueStore;
    readonly refreshKey: string;
    readonly widgetId: string;
    readonly tabs: TabChannel;
    readonly locks: LockManagerLike | null;
    readonly now: () => number;
}

/** Galat sesi yang membuat widget berhenti (tak bisa dipulihkan tanpa muat ulang). */
export const FATAL_SESSION_CODES = ['session_revoked', 'visitor_blocked', 'widget_unavailable', 'origin_not_allowed', 'webchat_unavailable'];

/**
 * Sesi pengunjung: token akses (memori) + refresh token berotasi (storage iframe). Server mencabut sesi bila satu
 * refresh token dipakai DUA kali — tab-tab pengunjung yang sama karenanya me-refresh BERGANTIAN di bawah satu kunci
 * (Web Locks), selalu membaca token terbaru dari storage, lalu membagikan token akses barunya ke tab lain.
 */
export class SessionManager {
    private accessToken: string | null = null;

    private expiresAt = 0;

    private session: Session | null = null;


    public constructor(private readonly deps: SessionDependencies) {
        deps.tabs.onMessage((message) => {
            if (message.type === 'session' && message.expiresAt > this.expiresAt) {
                this.accessToken = message.accessToken;
                this.expiresAt = message.expiresAt;
            }
        });
    }


    public get current(): Session | null {
        return this.session;
    }


    public get token(): string | null {
        return this.accessToken;
    }


    /** Mulai/lanjutkan sesi. Refresh token tersimpan yang tak sah lagi → sesi anonim baru, bukan macet. */
    public async start(body: Omit<BootBody, 'widget_id' | 'refresh_token'>): Promise<Session> {
        return this.exclusive(async () => {
            const stored = this.deps.storage.get(this.deps.refreshKey);
            try {
                const resume = stored ? { refresh_token: stored } : {};
                return this.adopt(await this.deps.api.boot({ ...body, widget_id: this.deps.widgetId, ...resume }));
            } catch (error) {
                if (!stored || !(error instanceof ApiError) || !['token_invalid', 'session_revoked'].includes(error.code)) {
                    throw error;
                }
                this.deps.storage.remove(this.deps.refreshKey);
                return this.adopt(await this.deps.api.boot({ ...body, widget_id: this.deps.widgetId }));
            }
        });
    }


    /** Panggil API dengan token akses segar; token kedaluwarsa di tengah jalan → refresh lalu coba sekali lagi. */
    public async withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
        if (!this.accessToken || this.expiresAt - this.deps.now() < REFRESH_MARGIN_MS) {
            await this.refresh();
        }
        try {
            return await call(this.requireToken());
        } catch (error) {
            if (!(error instanceof ApiError) || !['token_expired', 'token_invalid'].includes(error.code)) {
                throw error;
            }
            await this.refresh(true);
            return call(this.requireToken());
        }
    }


    public async refresh(force = false): Promise<void> {
        const requestedAt = this.deps.now();
        await this.exclusive(async () => {
            // Tab lain sudah me-refresh selama kita menunggu kunci → pakai token yang dibagikannya.
            const horizon = Math.max(this.deps.now(), requestedAt) + REFRESH_MARGIN_MS;
            const freshFromOtherTab = this.accessToken !== null && this.expiresAt > horizon;
            if (!force && freshFromOtherTab) {
                return;
            }
            const stored = this.deps.storage.get(this.deps.refreshKey);
            if (!stored) {
                throw new ApiError(401, 'session_revoked', 'refresh token tidak ada');
            }
            this.adopt(await this.deps.api.refresh(this.deps.widgetId, stored));
        });
    }


    /**
     * Identitas terverifikasi: hak sesi naik → server merotasi refresh token, jadi dijalankan di bawah kunci yang sama
     * dengan refresh (tab lain tak memakai refresh token lama bersamaan).
     */
    public async identify(identityToken: string): Promise<Session> {
        return this.elevate((token) => this.deps.api.identify(token, identityToken));
    }


    /** OTP email benar → sesi `verified` (W4c); rotasi refresh token sama seperti identify. */
    public async verifyOtp(email: string, code: string): Promise<Session> {
        return this.elevate((token) => this.deps.api.verifyOtp(token, email, code));
    }


    private async elevate(call: (token: string) => Promise<Session>): Promise<Session> {
        if (!this.accessToken || this.expiresAt - this.deps.now() < REFRESH_MARGIN_MS) {
            await this.refresh();
        }
        return this.exclusive(async () => this.adopt(await call(this.requireToken())));
    }


    /** Logout website tenant: sesi dicabut di server, storage dibersihkan, tab lain ikut. */
    public async shutdown(): Promise<void> {
        const token = this.accessToken;
        this.clear();
        this.deps.tabs.post({ type: 'shutdown' });
        if (token) {
            await this.deps.api.shutdown(token).catch(() => undefined);
        }
    }


    /** Lepas sesi di memori SAJA (tab lain sudah membersihkan storage & mungkin sudah menyimpan sesi barunya). */
    public forget(): void {
        this.accessToken = null;
        this.expiresAt = 0;
        this.session = null;
    }


    public clear(): void {
        this.deps.storage.remove(this.deps.refreshKey);
        this.accessToken = null;
        this.expiresAt = 0;
        this.session = null;
    }


    private adopt(session: Session): Session {
        this.deps.storage.set(this.deps.refreshKey, session.refresh_token);
        this.accessToken = session.access_token;
        this.expiresAt = this.deps.now() + session.expires_in * 1000;
        this.session = session;
        this.deps.tabs.post({ type: 'session', accessToken: session.access_token, expiresAt: this.expiresAt });
        return session;
    }


    private requireToken(): string {
        if (!this.accessToken) {
            throw new ApiError(401, 'session_revoked', 'tanpa token akses');
        }
        return this.accessToken;
    }


    private async exclusive<T>(task: () => Promise<T>): Promise<T> {
        const locks = this.deps.locks;
        if (!locks) {
            return task();
        }

        let result: T | undefined;
        await locks.request(`plasgos-webchat-session:${this.deps.widgetId}`, async () => {
            result = await task();
        });
        return result as T;
    }
}
