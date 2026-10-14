import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import { PlasgosWebchat, webchatState } from '../src/index';

function fakeLoader() {
    const calls: unknown[][] = [];
    const listeners = new Map<string, Set<() => void>>();
    let state = { booted: false, open: false, unread: 0, trustLevel: null as string | null };
    (window as unknown as { Plasgos: unknown }).Plasgos = (name: string, ...args: unknown[]): unknown => {
        calls.push([name, ...args]);
        if (name === 'on') {
            const set = listeners.get(args[0] as string) ?? new Set();
            set.add(args[1] as () => void);
            listeners.set(args[0] as string, set);
        }
        return name === 'getState' ? state : undefined;
    };
    (window as unknown as { __plasgosWebchat: unknown }).__plasgosWebchat = {};
    return {
        calls,
        emit(name: string, patch: Partial<typeof state>) {
            state = { ...state, ...patch };
            for (const handler of listeners.get(name) ?? []) handler();
        },
    };
}

const WIDGET_ID = 'wgt_0123456789abcdef01234567';

describe('@plasgos/webchat-svelte', () => {
    it('komponen: boot tanpa DOM; token → identify; logout → shutdown + boot; pathname → page', () => {
        const loader = fakeLoader();
        const target = document.body.appendChild(document.createElement('div'));
        const props = $state({ widgetId: WIDGET_ID, identityToken: undefined as string | undefined, pathname: '/' });
        const component = mount(PlasgosWebchat, { target, props });
        flushSync();

        props.identityToken = 'jwt-1';
        flushSync();
        props.pathname = '/akun';
        flushSync();
        props.identityToken = undefined;
        flushSync();

        expect(target.innerHTML.replace(/<!---->/g, '')).toBe('');
        const tracked = ['boot', 'identify', 'shutdown', 'page'];
        expect(loader.calls.map((call) => call[0]).filter((name) => tracked.includes(name as string)))
            .toEqual(['boot', 'identify', 'page', 'shutdown', 'boot']);
        expect(loader.calls[0]?.[1]).toEqual({ autoPageTracking: false, widgetId: WIDGET_ID });
        void unmount(component);
    });


    it('webchatState mengikuti event widget', () => {
        const loader = fakeLoader();
        const seen: number[] = [];
        const stop = webchatState.subscribe((state) => seen.push(state.unread));

        loader.emit('unread_changed', { unread: 5 });

        expect(get(webchatState).unread).toBe(5);
        expect(seen[seen.length - 1]).toBe(5);
        stop();
    });
});
