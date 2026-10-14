// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isBrowser, loadWebchat } from '../src/index';

describe('@plasgos/webchat di server (SSR)', () => {
    it('impor & panggil tanpa window/document tidak melempar dan tanpa efek', async () => {
        expect(isBrowser()).toBe(false);
        await expect(loadWebchat({ widgetId: 'wgt_000000000000000000000000' })).resolves.toBeUndefined();
    });
});
