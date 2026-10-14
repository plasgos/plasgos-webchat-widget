import { describe, expect, it } from 'vitest';

import { contrastRatio, safeColor, textOn } from '../src/colors';
import { errorText, resolveLocale } from '../src/i18n';
import { frameLayout, LAUNCHER_FRAME, WINDOW_WIDTH } from '../src/layout';

describe('warna tenant', () => {
    it('teks di atas warna utama selalu ≥ 3:1 (WCAG AA teks tebal/besar)', () => {
        for (const color of ['#f0592b', '#ffd400', '#1d4ed8', '#22c55e', '#ffffff', '#000000']) {
            expect(contrastRatio(color, textOn(color))).toBeGreaterThanOrEqual(3);
        }
    });


    it('warna tak sah → warna bawaan', () => {
        expect(safeColor('red')).toBe('#f0592b');
        expect(safeColor('#ABCDEF')).toBe('#abcdef');
    });
});

describe('teks', () => {
    it('galat dipilih dari kode; kode tak dikenal → teks umum, bukan pesan mentah server', () => {
        expect(errorText('id', 'rate_limited', { seconds: 12 })).toBe('Terlalu banyak permintaan. Coba lagi dalam 12 detik.');
        expect(errorText('en', 'tidak_dikenal')).toBe('Something went wrong. Please try again.');
        expect(resolveLocale('fr', 'en')).toBe('en');
    });
});

describe('tata letak bingkai', () => {
    const appearance = { position: 'left' as const, offset: { x: 24, y: 16 } };

    it('tertutup = launcher; disembunyikan = hidden', () => {
        expect(frameLayout(false, appearance, { width: 1280, height: 800 }, false)).toMatchObject({ state: 'launcher', width: LAUNCHER_FRAME, position: 'left', offsetX: 24 });
        expect(frameLayout(false, appearance, { width: 1280, height: 800 }, true).state).toBe('hidden');
    });


    it('terbuka: jendela di desktop, layar penuh di ponsel', () => {
        expect(frameLayout(true, appearance, { width: 1280, height: 800 }, false)).toMatchObject({ state: 'open', width: WINDOW_WIDTH, height: 640, fullscreen: false });
        expect(frameLayout(true, appearance, { width: 390, height: 780 }, false)).toMatchObject({ state: 'open', width: 390, height: 780, fullscreen: true });
    });
});
