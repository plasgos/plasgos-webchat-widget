import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchNavigation } from '../src/navigation';

describe('deteksi navigasi SPA (tanpa Navigation API)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        window.history.replaceState(null, '', '/awal');
    });

    afterEach(() => {
        vi.useRealTimers();
    });


    it('pushState melapor sekali setelah URL & judul tenang; URL yang sama tak dilaporkan', () => {
        const onChange = vi.fn();
        const stop = watchNavigation(window, onChange);

        window.history.pushState(null, '', '/produk');
        window.history.pushState(null, '', '/produk');
        vi.advanceTimersByTime(300);
        window.history.replaceState(null, '', '/produk');
        vi.advanceTimersByTime(300);

        expect(onChange).toHaveBeenCalledTimes(1);
        stop();
    });


    it('pembungkus berantai: fungsi history asli tetap dipanggil, dan berhenti melapor setelah stop', () => {
        const onChange = vi.fn();
        const stop = watchNavigation(window, onChange);
        stop();

        window.history.pushState({ halaman: 2 }, '', '/kategori');
        vi.advanceTimersByTime(300);

        expect(window.location.pathname).toBe('/kategori');
        expect(window.history.state).toEqual({ halaman: 2 });
        expect(onChange).not.toHaveBeenCalled();
    });
});
