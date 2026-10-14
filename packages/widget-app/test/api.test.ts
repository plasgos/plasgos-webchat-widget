import { describe, expect, it } from 'vitest';

import { ApiError, PublicApi } from '../src/api';

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('klien API publik', () => {
    it('sukses → isi `data`; permintaan tanpa cookie & dengan token pengunjung', async () => {
        const seen: { url: string; init?: RequestInit }[] = [];
        const api = new PublicApi('https://widget.test', (url, init) => {
            seen.push({ url, ...(init ? { init } : {}) });
            return Promise.resolve(respond(202, { success: true, data: { message_id: 'wcm_1', client_message_id: 'c', status: 'accepted', duplicate: false } }));
        });

        await expect(api.send('tok', { client_message_id: 'c', text: 'Halo' })).resolves.toMatchObject({ message_id: 'wcm_1' });
        expect(seen[0]?.url).toBe('https://widget.test/webchat/v1/messages');
        expect(seen[0]?.init?.credentials).toBe('omit');
        expect((seen[0]?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
    });


    it('galat → kode stabil + Retry-After (body atau header); sementara vs permanen', async () => {
        const limited = new PublicApi('', () => Promise.resolve(respond(429, { success: false, message: 'x', error_code: 'rate_limited' }, { 'retry-after': '7' })));
        const blocked = new PublicApi('', () => Promise.resolve(respond(403, { success: false, message: 'x', error_code: 'visitor_blocked' })));

        const rateError = await limited.config('wgt_1').catch((error: unknown) => error);
        expect(rateError).toBeInstanceOf(ApiError);
        expect(rateError).toMatchObject({ status: 429, code: 'rate_limited', retryAfterSeconds: 7, transient: true });
        await expect(blocked.config('wgt_1')).rejects.toMatchObject({ code: 'visitor_blocked', transient: false });
    });


    it('jaringan putus → kode `network` (sementara)', async () => {
        const api = new PublicApi('', () => Promise.reject(new TypeError('Failed to fetch')));

        await expect(api.config('wgt_1')).rejects.toMatchObject({ status: 0, code: 'network', transient: true });
    });
});
