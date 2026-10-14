import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';

import { PlasgosWebchatPlugin, usePlasgosWebchat } from '../src/index';
import type { WebchatHandle } from '../src/index';

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

describe('@plasgos/webchat-vue', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });


    it('plugin: boot; dengan router → navigasi (URL berubah) dilaporkan dari afterEach & deteksi otomatis loader dimatikan', async () => {
        const loader = fakeLoader();
        const hooks: (() => void)[] = [];
        const router = { afterEach: (hook: () => void) => { hooks.push(hook); } };
        const app = createApp({ render: () => h('div') });
        app.use(PlasgosWebchatPlugin, { widgetId: WIDGET_ID, router });
        app.mount(document.body.appendChild(document.createElement('div')));

        expect(loader.calls.find((call) => call[0] === 'boot')?.[1]).toEqual({ autoPageTracking: false, widgetId: WIDGET_ID });
        hooks.forEach((hook) => { hook(); });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(loader.calls.filter((call) => call[0] === 'page')).toHaveLength(0);

        window.history.pushState({}, '', '/produk');
        hooks.forEach((hook) => { hook(); });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(loader.calls.filter((call) => call[0] === 'page')).toHaveLength(1);
    });


    it('composable: state reaktif mengikuti event widget; login/logout lewat setIdentityToken', async () => {
        const loader = fakeLoader();
        let webchat: WebchatHandle | null = null;
        const Badge = defineComponent({
            setup() {
                webchat = usePlasgosWebchat();
                return () => h('span', String(webchat?.state.value.unread ?? -1));
            },
        });
        const host = document.body.appendChild(document.createElement('div'));
        createApp(Badge).use(PlasgosWebchatPlugin, { widgetId: WIDGET_ID }).mount(host);
        expect(host.textContent).toBe('0');

        loader.emit('unread_changed', { unread: 2 });
        await nextTick();
        expect(host.textContent).toBe('2');

        const handle = webchat as WebchatHandle | null;
        if (!handle) throw new Error('composable tak terpasang');
        handle.setIdentityToken('jwt-1');
        handle.setIdentityToken(null);
        const sequence = loader.calls.map((call) => call[0]).filter((name) => ['boot', 'identify', 'shutdown'].includes(name as string));
        expect(sequence).toEqual(['boot', 'identify', 'shutdown', 'boot']);
    });
});
