import { describe, expect, it, vi } from 'vitest';

import { COMMAND_KEY, GLOBAL_KEY, installGlobal } from '../src/global';

type HostWindow = Window & Record<string, unknown>;

function fakeWindow(): HostWindow {
    return {} as HostWindow;
}

describe('singleton & antrean perintah', () => {
    it('antrean snippet diputar ulang BERURUTAN ke handler', () => {
        const host = fakeWindow();
        host[COMMAND_KEY] = Object.assign((): void => undefined, { q: [['boot', { widgetId: 'wgt_1' }], ['open']] });
        const handler = vi.fn();

        installGlobal(host, 1, handler);

        expect(handler.mock.calls).toEqual([['boot', [{ widgetId: 'wgt_1' }]], ['open', []]]);
    });


    it('dipasang dua kali (snippet ganda / plugin + snippet) tetap satu singleton; pemasangan kedua tak aktif', () => {
        const host = fakeWindow();
        const first = installGlobal(host, 1, vi.fn());
        const second = installGlobal(host, 1, vi.fn());

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.instance).toBe(first.instance);
        expect(host[GLOBAL_KEY]).toBe(first.instance);
    });


    it('Plasgos(...) setelah loader siap memanggil handler dan mengembalikan nilainya', () => {
        const host = fakeWindow();
        installGlobal(host, 1, (name) => (name === 'getState' ? { booted: true } : undefined));
        const call = host[COMMAND_KEY] as (...args: unknown[]) => unknown;

        expect(call('getState')).toEqual({ booted: true });
    });
});
