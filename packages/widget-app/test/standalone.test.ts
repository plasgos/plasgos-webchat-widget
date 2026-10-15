import { describe, expect, it, vi } from 'vitest';

import { takeStandaloneIdentity } from '../src/standalone';

const BASE = 'https://widget.plasgoschat.com/m/wgt_0123456789abcdef01234567?utm_source=instagram';

describe('halaman chat penuh: token identitas dari fragmen URL', () => {
    it('token dibaca lalu fragmennya dihapus dari alamat (riwayat & jejak halaman bersih)', () => {
        const replace = vi.fn();
        const page = takeStandaloneIdentity({ href: `${BASE}#identity_token=aaa.bbb.ccc`, hash: '#identity_token=aaa.bbb.ccc' }, replace);
        expect(page).toEqual({ identityToken: 'aaa.bbb.ccc', url: BASE });
        expect(replace).toHaveBeenCalledWith(BASE);
    });

    it('parameter fragmen lain dipertahankan; tanpa token = alamat tak disentuh', () => {
        const replace = vi.fn();
        expect(takeStandaloneIdentity({ href: `${BASE}#identity_token=t&tab=chat`, hash: '#identity_token=t&tab=chat' }, replace)).toEqual({ identityToken: 't', url: `${BASE}#tab=chat` });
        replace.mockClear();
        expect(takeStandaloneIdentity({ href: BASE, hash: '' }, replace)).toEqual({ identityToken: null, url: BASE });
        expect(replace).not.toHaveBeenCalled();
    });

    it('token kosong / terlalu panjang diabaikan, fragmennya tetap dihapus', () => {
        const replace = vi.fn();
        expect(takeStandaloneIdentity({ href: `${BASE}#identity_token=`, hash: '#identity_token=' }, replace).identityToken).toBeNull();
        expect(takeStandaloneIdentity({ href: `${BASE}#identity_token=${'x'.repeat(8193)}`, hash: `#identity_token=${'x'.repeat(8193)}` }, replace).identityToken).toBeNull();
        expect(replace).toHaveBeenCalledTimes(2);
    });
});
