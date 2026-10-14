import { expect, test } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';

/**
 * Matriks §7 (W3d): Web Component di halaman Solid & Lit — atribut → identify/shutdown; snippet + paket npm
 * terpasang bersamaan — tetap satu widget. Iframe = stub protokol v1 (`fixtures/_widget-stub`).
 */

const ROOT = '#plasgos-webchat-root';

interface Received {
    readonly type: string;
    readonly payload: { readonly name?: string; readonly args?: readonly unknown[] };
}

function liveWidgetFrame(page: Page): Frame | undefined {
    return page.frames().filter((frame) => frame.url().includes('/w/wgt_') && !frame.isDetached()).pop();
}

async function receivedCount(page: Page): Promise<number> {
    const frame = liveWidgetFrame(page);
    if (!frame) return 0;
    return frame.evaluate(() => (window as unknown as { __received?: unknown[] }).__received?.length ?? 0);
}

async function commandsOf(page: Page, name: string): Promise<Received[]> {
    const frame = liveWidgetFrame(page);
    if (!frame) return [];
    const received = await frame.evaluate(() => (window as unknown as { __received?: Received[] }).__received ?? []);
    return received.filter((message) => message.type === 'host.command' && message.payload.name === name);
}

for (const fixture of ['solid-element', 'lit-element']) {
    test(`${fixture}: <plasgos-webchat> menyalakan satu widget; masuk → identify, keluar → shutdown`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`/fixtures/${fixture}/`);

        await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
        await expect.poll(() => receivedCount(page)).toBeGreaterThan(0);

        await page.click('#login');
        const identified = async (): Promise<unknown[]> =>
            (await commandsOf(page, 'identify')).map((message) => message.payload.args?.[0]);
        await expect.poll(identified)
            .toEqual([{ token: fixture === 'solid-element' ? 'jwt-pelanggan-solid' : 'jwt-pelanggan-lit' }]);

        await page.click('#logout');
        // shutdown: iframe diberi tahu lalu widget dilepas loader.
        await expect(page.locator(ROOT)).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}

test('snippet resmi + paket npm terpasang bersamaan → satu loader, satu widget', async ({ page }) => {
    await page.goto('/fixtures/snippet-and-npm/');

    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
    expect(await page.locator('script[src="/packages/loader/dist/loader.js"]').count()).toBe(1);
    await page.waitForTimeout(500);
    await expect(page.locator(ROOT)).toHaveCount(1);
});

for (const major of ['18', '19']) {
    test(`React ${major} StrictMode: efek dua kali tetap satu widget; open() dari hook membuka chat`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`/fixtures/react-${major}-strict/`);

        await expect(page.locator('#versi')).toContainText(`React ${major}.`);
        await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
        await expect(page.locator(ROOT)).toHaveCount(1);
        expect(await page.locator('script[src="/packages/loader/dist/loader.js"]').count()).toBe(1);

        await page.click('#bantuan');

        await expect.poll(async () => (await commandsOf(page, 'open')).length).toBe(1);
        expect(errors).toEqual([]);
    });
}

test('Vue 3 + Vue Router: satu widget; navigasi dilaporkan SEKALI dari router; composable membuka chat', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/fixtures/vue3-router/');
    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
    await expect.poll(() => receivedCount(page)).toBeGreaterThan(0);

    await page.click('#ke-produk');
    await expect(page.locator('h2')).toHaveText('Produk');

    await expect.poll(async () => (await commandsOf(page, 'page')).length).toBe(1);
    await page.waitForTimeout(600);
    const pages = await commandsOf(page, 'page');
    expect(pages).toHaveLength(1);
    expect(pages[0]?.payload.args?.[0]).toMatchObject({ url: expect.stringContaining('/produk'), title: 'Vue — produk' });

    await page.click('#bantuan');
    await expect.poll(async () => (await commandsOf(page, 'open')).length).toBe(1);
    expect(errors).toEqual([]);
});
