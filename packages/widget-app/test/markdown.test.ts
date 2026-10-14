import { describe, expect, it } from 'vitest';

import { renderMarkdown, safeHref, tokenize } from '../src/markdown';

function html(text: string): string {
    const container = document.createElement('div');
    container.appendChild(renderMarkdown(document, text));
    return container.innerHTML;
}

describe('markdown aman untuk balasan tim', () => {
    it('subset: tebal, miring (* dan _), kode, baris baru', () => {
        expect(html('**Masih** ada, ukuran _M_ dan *L*.\nKode: `KAOS-M`')).toBe(
            '<strong>Masih</strong> ada, ukuran <em>M</em> dan <em>L</em>.<br>Kode: <code>KAOS-M</code>',
        );
    });


    it('HTML di teks pesan tetap TEKS, tak pernah jadi elemen', () => {
        expect(html('<img src=x onerror=alert(1)><script>alert(2)</script>')).toBe(
            '&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(2)&lt;/script&gt;',
        );
    });


    it('tautan hanya https/http/mailto, dibuka di tab baru tanpa akses ke jendela widget', () => {
        expect(html('[Katalog](https://toko.com/katalog)')).toBe(
            '<a href="https://toko.com/katalog" target="_blank" rel="noopener noreferrer nofollow">Katalog</a>',
        );
        expect(html('[klik](javascript:alert(1))')).toBe('[klik](javascript:alert(1))');
        expect(safeHref('data:text/html,hi')).toBeNull();
    });


    it('URL telanjang dikenali tanpa ikut tanda baca penutup kalimat', () => {
        const tokens = tokenize('Cek https://toko.com/promo.');

        expect(tokens).toEqual([
            { kind: 'text', value: 'Cek ' },
            { kind: 'link', value: 'https://toko.com/promo', href: 'https://toko.com/promo' },
            { kind: 'text', value: '.' },
        ]);
    });


    it('kata dengan garis bawah/asterisk di tengah tidak dianggap miring', () => {
        expect(html('nama_file_baru dan 2*3*4')).toBe('nama_file_baru dan 2*3*4');
    });
});
