import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PlasgosWebchat, usePlasgosWebchat } from '../src/index';

/** Loader palsu: mencatat perintah & memanggil pendengar `on` seperti loader asli. */
function fakeLoader() {
    const calls: unknown[][] = [];
    const listeners = new Map<string, Set<(data: unknown) => void>>();
    let state = { booted: false, open: false, unread: 0, trustLevel: null as string | null };
    const plasgos = (name: string, ...args: unknown[]): unknown => {
        calls.push([name, ...args]);
        if (name === 'on') {
            const set = listeners.get(args[0] as string) ?? new Set();
            set.add(args[1] as (data: unknown) => void);
            listeners.set(args[0] as string, set);
        }
        if (name === 'off') listeners.get(args[0] as string)?.delete(args[1] as (data: unknown) => void);
        if (name === 'getState') return state;
        return undefined;
    };
    (window as unknown as { Plasgos: unknown }).Plasgos = plasgos;
    (window as unknown as { __plasgosWebchat: unknown }).__plasgosWebchat = {};
    return {
        calls,
        emit(name: string, patch: Partial<typeof state>) {
            state = { ...state, ...patch };
            for (const handler of listeners.get(name) ?? []) handler({});
        },
        names: () => calls.map((call) => call[0]),
    };
}

const WIDGET_ID = 'wgt_0123456789abcdef01234567';
let root: Root;
let container: HTMLDivElement;

describe('@plasgos/webchat-react', () => {
    beforeEach(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
    });


    it('StrictMode (efek dua kali) tetap boot widget yang sama; komponen tak merender DOM', () => {
        const loader = fakeLoader();
        act(() => { root.render(<StrictMode><PlasgosWebchat widgetId={WIDGET_ID} /></StrictMode>); });

        expect(container.innerHTML).toBe('');
        const boots = loader.calls.filter((call) => call[0] === 'boot');
        expect(boots.length).toBeGreaterThanOrEqual(1);
        const booted = new Set(boots.map((call) => JSON.stringify(call[1])));
        expect(booted).toEqual(new Set([JSON.stringify({ widgetId: WIDGET_ID })]));
    });


    it('login → identify; logout → shutdown lalu sesi anonim baru; pathname berubah → page', () => {
        const loader = fakeLoader();
        act(() => { root.render(<PlasgosWebchat widgetId={WIDGET_ID} pathname="/" />); });
        act(() => { root.render(<PlasgosWebchat widgetId={WIDGET_ID} pathname="/" identityToken="jwt-1" />); });
        act(() => { root.render(<PlasgosWebchat widgetId={WIDGET_ID} pathname="/akun" identityToken="jwt-1" />); });
        act(() => { root.render(<PlasgosWebchat widgetId={WIDGET_ID} pathname="/akun" />); });

        const tracked = ['boot', 'identify', 'shutdown', 'page'];
        const sequence = loader.calls.filter((call) => tracked.includes(call[0] as string)).map((call) => call[0]);
        expect(sequence).toEqual(['boot', 'identify', 'page', 'shutdown', 'boot']);
        expect(loader.calls.find((call) => call[0] === 'identify')?.[1]).toEqual({ token: 'jwt-1' });
        // Aplikasi melaporkan navigasi (pathname) → deteksi otomatis loader dimatikan, tanpa laporan ganda.
        expect(loader.calls.find((call) => call[0] === 'boot')?.[1]).toEqual({ autoPageTracking: false, widgetId: WIDGET_ID });
    });


    it('usePlasgosWebchat: keadaan ikut event widget (render ulang); open() diteruskan', () => {
        const loader = fakeLoader();
        let latest: ReturnType<typeof usePlasgosWebchat> | null = null;
        function Badge(): React.JSX.Element {
            latest = usePlasgosWebchat();
            return <span>{latest.state.unread}</span>;
        }
        act(() => { root.render(<Badge />); });
        expect(container.textContent).toBe('0');

        act(() => { loader.emit('unread_changed', { unread: 3 }); });
        expect(container.textContent).toBe('3');

        act(() => { latest?.open(); });
        expect(loader.names()).toContain('open');
    });
});
