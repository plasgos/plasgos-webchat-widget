// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getWebchat, isBrowser, loadWebchat } from '../src/index';

describe('@plasgos/webchat di server (SSR)', () => {
    it('impor & panggil tanpa window/document: tak melempar, tanpa efek, klien no-op', async () => {
        expect(isBrowser()).toBe(false);
        const client = await loadWebchat({ widgetId: 'wgt_000000000000000000000000' });

        expect(client).toBe(getWebchat());
        expect(() => {
            client.open();
            client.identify('jwt');
            client.on('message', () => undefined)();
        }).not.toThrow();
        expect(client.getState()).toEqual({ booted: false, open: false, unread: 0, trustLevel: null });
    });


    it('mengimpor Web Component di server tak mendefinisikan apa pun dan tak melempar', async () => {
        await expect(import('../src/element')).resolves.toBeDefined();
    });
});
