import { describe, expect, it } from 'vitest';

import { COMMAND_KEY, GLOBAL_KEY, installGlobal } from '../src/global';

function fakeWindow(): Window {
    return {} as Window;
}

describe('singleton loader', () => {
    it('mengambil alih antrean snippet yang terkumpul sebelum loader siap', () => {
        const host = fakeWindow() as Window & Record<string, unknown>;
        const stub = Object.assign((): void => undefined, { q: [['boot', { widgetId: 'wgt_1' }]] });
        host[COMMAND_KEY] = stub;

        const instance = installGlobal(host, 1);

        expect(instance.pending).toEqual([['boot', { widgetId: 'wgt_1' }]]);
    });


    it('dipasang dua kali (snippet ganda / HMR) tetap satu singleton', () => {
        const host = fakeWindow() as Window & Record<string, unknown>;

        const first = installGlobal(host, 1);
        const second = installGlobal(host, 1);

        expect(second).toBe(first);
        expect(host[GLOBAL_KEY]).toBe(first);
    });


    it('panggilan Plasgos(...) setelah loader siap masuk ke singleton', () => {
        const host = fakeWindow() as Window & Record<string, (...args: unknown[]) => void>;
        const instance = installGlobal(host, 1);

        host[COMMAND_KEY]?.('open');

        expect(instance.pending).toEqual([['open']]);
    });
});
