// Pustaka Angular terkompilasi parsial → di luar build Angular CLI butuh JIT compiler (aplikasi sungguhan tidak).
import '@angular/compiler';
import { describe, expect, it } from 'vitest';

import { PlasgosWebchatService } from '../src/index';
import type { ZoneLike } from '../src/index';

function fakeLoader() {
    const calls: unknown[][] = [];
    const listeners = new Map<string, Set<(data: unknown) => void>>();
    let state = { booted: false, open: false, unread: 0, trustLevel: null as string | null };
    (window as unknown as { Plasgos: unknown }).Plasgos = (name: string, ...args: unknown[]): unknown => {
        calls.push([name, ...args]);
        if (name === 'on') {
            const set = listeners.get(args[0] as string) ?? new Set();
            set.add(args[1] as (data: unknown) => void);
            listeners.set(args[0] as string, set);
        }
        return name === 'getState' ? state : undefined;
    };
    (window as unknown as { __plasgosWebchat: unknown }).__plasgosWebchat = {};
    return {
        calls,
        emit(name: string, patch: Partial<typeof state>, data: unknown = {}) {
            state = { ...state, ...patch };
            for (const handler of listeners.get(name) ?? []) handler(data);
        },
    };
}

/** Zona palsu: mencatat siapa yang masuk/keluar zona. */
function zone(): ZoneLike & { inside: number; outside: number } {
    const record = { inside: 0, outside: 0 };
    return {
        get inside() { return record.inside; },
        get outside() { return record.outside; },
        run: <T>(fn: () => T): T => { record.inside += 1; return fn(); },
        runOutsideAngular: <T>(fn: () => T): T => { record.outside += 1; return fn(); },
    };
}

describe('PlasgosWebchatService', () => {
    it('state (signal) mengikuti event widget; pembaruan berjalan DI DALAM zona', () => {
        const loader = fakeLoader();
        const ngZone = zone();
        const service = new PlasgosWebchatService(ngZone, { widgetId: 'wgt_0123456789abcdef01234567' });
        service.listen();

        loader.emit('unread_changed', { unread: 4 });

        expect(service.state().unread).toBe(4);
        expect(ngZone.inside).toBeGreaterThan(0);
    });


    it('pendengar tenant dijalankan di dalam zona; login/logout lewat setIdentityToken', () => {
        const loader = fakeLoader();
        const ngZone = zone();
        const service = new PlasgosWebchatService(ngZone, { widgetId: 'wgt_0123456789abcdef01234567' });
        const received: unknown[] = [];
        service.on('message', (data) => received.push(data));

        loader.emit('message', {}, { text: 'Halo' });
        service.setIdentityToken('jwt-1');
        service.setIdentityToken(null);

        expect(received).toEqual([{ text: 'Halo' }]);
        expect(loader.calls.map((call) => call[0]).filter((name) => name !== 'on' && name !== 'getState')).toEqual(['identify', 'shutdown', 'boot']);
        expect(ngZone.outside).toBe(1);
    });
});
