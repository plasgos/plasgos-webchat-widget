import { beforeEach, describe, expect, it, vi } from 'vitest';

type HostWindow = Window & Record<string, unknown>;

async function fresh() {
    vi.resetModules();
    return import('../src/index');
}

function loaders(): HTMLScriptElement[] {
    return Array.from(document.querySelectorAll('script[data-widget-id]'));
}

describe('@plasgos/webchat di peramban', () => {
    beforeEach(() => {
        document.head.replaceChildren();
        const host = window as unknown as HostWindow;
        delete host['Plasgos'];
        delete host['__plasgosWebchat'];
        delete host['trustedTypes'];
    });


    it('boot & identify masuk antrean yang sama dengan snippet; loader disuntik SEKALI walau dipanggil berulang', async () => {
        const { loadWebchat } = await fresh();
        const options = { widgetId: 'wgt_0123456789abcdef01234567', identityToken: 'jwt-tenant', loaderUrl: '/loader.js', widgetOrigin: 'https://widget.test', nonce: 'n0nce' };

        await loadWebchat(options);
        await loadWebchat(options);

        expect(loaders()).toHaveLength(1);
        const script = loaders()[0];
        expect(script?.getAttribute('data-widget-origin')).toBe('https://widget.test');
        expect(script?.nonce).toBe('n0nce');
        const queue = (window as unknown as { Plasgos: { q: unknown[][] } }).Plasgos.q;
        expect(queue[0]).toEqual(['boot', { widgetId: 'wgt_0123456789abcdef01234567' }]);
        expect(queue[1]).toEqual(['identify', { token: 'jwt-tenant' }]);
    });


    it('snippet/plugin sudah memasang loader → paket tak menyuntik loader kedua', async () => {
        const existing = document.createElement('script');
        existing.src = 'https://cdn.plasgoschat.com/loader/v1/loader.js';
        document.head.appendChild(existing);
        const { loadWebchat } = await fresh();

        await loadWebchat({ widgetId: 'wgt_0123456789abcdef01234567' });

        expect(document.querySelectorAll('script')).toHaveLength(1);
    });


    it('Trusted Types: src diisi lewat kebijakan "plasgos-webchat"', async () => {
        const createPolicy = vi.fn((_name: string, rules: { createScriptURL: (value: string) => string }) => ({
            createScriptURL: (value: string) => rules.createScriptURL(value),
        }));
        (window as unknown as HostWindow)['trustedTypes'] = { createPolicy };
        const { loadWebchat } = await fresh();

        await loadWebchat({ widgetId: 'wgt_0123456789abcdef01234567', loaderUrl: '/loader.js' });

        expect(createPolicy).toHaveBeenCalledWith('plasgos-webchat', expect.any(Object));
        expect(loaders()[0]?.getAttribute('src')).toBe('/loader.js');
    });


    it('klien: perintah diteruskan; on() mengembalikan pelepas; getState kosong sebelum loader siap', async () => {
        const { client } = await fresh();
        const handler = vi.fn();

        client.open();
        const off = client.on('message', handler);
        off();

        const queue = (window as unknown as { Plasgos: { q: unknown[][] } }).Plasgos.q;
        expect(queue.map((call) => call[0])).toEqual(['open', 'on', 'off' ]);
        expect(client.getState()).toEqual({ booted: false, open: false, unread: 0, trustLevel: null });
    });
});
