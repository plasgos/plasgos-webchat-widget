import { describe, expect, it, vi } from 'vitest';

import { standaloneApi, stripIdentityFragment } from '../src/standalone';

const BASE = 'https://widget.plasgoschat.my.id/m/wgt_0123456789abcdef01234567?utm_source=instagram';

describe('halaman chat penuh: identitas TIDAK dari URL (login CSRF, W10b)', () => {
    it('fragmen #identity_token dihapus dari alamat & diabaikan; fragmen lain dipertahankan', () => {
        const replace = vi.fn();
        expect(stripIdentityFragment({ href: `${BASE}#identity_token=jwt-penyerang&tab=chat`, hash: '#identity_token=jwt-penyerang&tab=chat' }, replace))
            .toEqual({ url: `${BASE}#tab=chat`, stripped: true });
        expect(replace).toHaveBeenCalledWith(`${BASE}#tab=chat`);
    });

    it('tanpa fragmen identitas → alamat tak disentuh', () => {
        const replace = vi.fn();
        expect(stripIdentityFragment({ href: BASE, hash: '' }, replace)).toEqual({ url: BASE, stripped: false });
        expect(replace).not.toHaveBeenCalled();
    });

    it('Plasgos(...) untuk JavaScript yang disuntikkan aplikasi: hanya perintah sesi/identitas', () => {
        const run = vi.fn();
        const api = standaloneApi(run);
        api('identify', { token: 'jwt-aplikasi' });
        api('boot', { widgetId: 'wgt_x' });
        api('open');
        api(42);
        expect(run.mock.calls).toEqual([[{ name: 'identify', args: [{ token: 'jwt-aplikasi' }] }]]);
    });
});
