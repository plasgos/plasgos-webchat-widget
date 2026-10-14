import { expect, test } from '@playwright/test';

/**
 * W3g: rilis CDN berversi. Bucket lokal disiapkan `global-setup.ts` (1.0.0, 1.1.0, lalu alias v1 di-ROLLBACK ke
 * 1.0.0); server fixture berperan CloudFront di `/cdn/*`.
 */

const ROOT = '#plasgos-webchat-root';

test('SRI: loader versi terkunci dengan integrity dari manifest → widget tampil', async ({ page }) => {
    await page.goto('/fixtures/cdn-sri/?v=1.0.0');

    await expect(page.locator('body')).toHaveAttribute('data-loader', 'loaded');
    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
});

test('SRI: integrity tak cocok → peramban menolak loader, widget tak tampil', async ({ page }) => {
    await page.goto('/fixtures/cdn-sri/?v=1.0.0&tamper=1');

    await expect(page.locator('body')).toHaveAttribute('data-loader', 'blocked');
    await page.waitForTimeout(500);
    await expect(page.locator(ROOT)).toHaveCount(0);
});

test('rollback: alias v1 menunjuk 1.0.0 (isi sama persis), header alias 5 menit & versi immutable, CORS terbuka', async ({ request }) => {
    const pointer = await (await request.get('/cdn/releases/v1.json')).json() as { version: string };
    expect(pointer.version).toBe('1.0.0');

    const alias = await request.get('/cdn/loader/v1/loader.js');
    const pinned = await request.get('/cdn/loader/1.0.0/loader.js');
    expect(await alias.body()).toEqual(await pinned.body());
    expect(alias.headers()['cache-control']).toBe('public, max-age=300');
    expect(pinned.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(pinned.headers()['access-control-allow-origin']).toBe('*');
    expect(pinned.headers()['content-type']).toBe('text/javascript; charset=utf-8');
    expect((await request.get('/cdn/loader/1.1.0/loader.js')).status()).toBe(200);
    expect((await request.get('/cdn/.meta/invalidations.log')).status()).toBe(404);
});
