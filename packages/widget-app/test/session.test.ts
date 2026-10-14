import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../src/api';
import type { PublicApi } from '../src/api';
import { SessionManager } from '../src/session';
import type { KeyValueStore } from '../src/storage';
import type { TabChannel, TabMessage } from '../src/tabs';
import type { Session } from '../src/types';

function last<T>(list: readonly T[]): T | undefined {
    return list[list.length - 1];
}

const KEY = 'refresh';

function memory(initial: Record<string, string> = {}): KeyValueStore {
    const values = new Map(Object.entries(initial));
    return {
        get: (key) => values.get(key) ?? null,
        set: (key, value) => { values.set(key, value); },
        remove: (key) => { values.delete(key); },
    };
}

function tabs(): TabChannel & { sent: TabMessage[] } {
    const sent: TabMessage[] = [];
    return { sent, post: (message) => { sent.push(message); }, onMessage: () => undefined, close: () => undefined };
}

function session(token: string, refresh: string): Session {
    return { access_token: token, expires_in: 900, refresh_token: refresh, visitor_id: 'vis_1', trust_level: 'anonymous', conversation: null };
}

/** Kunci berurutan seperti Web Locks: tugas berikutnya baru jalan setelah yang sebelumnya selesai. */
function serialLocks(): { request: (name: string, callback: () => Promise<unknown>) => Promise<unknown> } {
    let chain = Promise.resolve();
    return {
        request: (_name, callback) => {
            const run = chain.then(callback);
            chain = run.then(() => undefined, () => undefined);
            return run;
        },
    };
}

function manager(api: Partial<PublicApi>, storage = memory(), now = () => 0) {
    const channel = tabs();
    const instance = new SessionManager({ api: api as PublicApi, storage, refreshKey: KEY, widgetId: 'wgt_1', tabs: channel, locks: serialLocks(), now });
    return { instance, storage, channel };
}

describe('sesi pengunjung', () => {
    it('refresh token tersimpan yang sudah tak sah → sesi anonim baru, bukan macet', async () => {
        const boot = vi.fn()
            .mockRejectedValueOnce(new ApiError(401, 'session_revoked', 'dicabut'))
            .mockResolvedValueOnce(session('akses-baru', 'rt-baru'));
        const { instance, storage } = manager({ boot }, memory({ [KEY]: 'rt-lama' }));

        await instance.start({ page_origin: 'https://toko.com' });

        expect(boot.mock.calls[0]?.[0]).toMatchObject({ refresh_token: 'rt-lama' });
        expect(boot.mock.calls[1]?.[0]).not.toHaveProperty('refresh_token');
        expect(storage.get(KEY)).toBe('rt-baru');
        expect(instance.token).toBe('akses-baru');
    });


    it('token kedaluwarsa di tengah panggilan → refresh lalu ulang sekali', async () => {
        const refresh = vi.fn().mockResolvedValue(session('akses-2', 'rt-2'));
        const { instance } = manager({ boot: vi.fn().mockResolvedValue(session('akses-1', 'rt-1')), refresh });
        await instance.start({});
        const call = vi.fn().mockRejectedValueOnce(new ApiError(401, 'token_expired', 'habis')).mockResolvedValueOnce('ok');

        await expect(instance.withToken(call)).resolves.toBe('ok');

        expect(call.mock.calls.map(([token]) => token as string)).toEqual(['akses-1', 'akses-2']);
        expect(refresh).toHaveBeenCalledWith('wgt_1', 'rt-1');
    });


    it('dua refresh bersamaan (dua tab / dua panggilan) → token diputar SEKALI; yang kedua memakai hasil pertama', async () => {
        let clock = 0;
        const refresh = vi.fn().mockImplementation(() => Promise.resolve(session('akses-baru', 'rt-baru')));
        const { instance } = manager({ boot: vi.fn().mockResolvedValue(session('akses-1', 'rt-1')), refresh }, memory(), () => clock);
        await instance.start({});
        clock = 880_000; // token hampir habis

        await Promise.all([instance.refresh(), instance.refresh()]);

        expect(refresh).toHaveBeenCalledTimes(1);
    });


    it('token baru dibagikan ke tab lain; shutdown membersihkan storage & memberi tahu tab lain', async () => {
        const shutdown = vi.fn().mockResolvedValue({ revoked: true });
        const { instance, storage, channel } = manager({ boot: vi.fn().mockResolvedValue(session('akses-1', 'rt-1')), shutdown });
        await instance.start({});

        expect(channel.sent[0]).toMatchObject({ type: 'session', accessToken: 'akses-1' });

        await instance.shutdown();

        expect(shutdown).toHaveBeenCalledWith('akses-1');
        expect(storage.get(KEY)).toBeNull();
        expect(last(channel.sent)).toEqual({ type: 'shutdown' });
    });
});
