import { expect, test } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';

/**
 * Loader di website tenant sungguhan (W3b) — WEBCHAT_EMBED_COMPATIBILITY.md §5. Iframe dimuat dari origin LAIN
 * (127.0.0.1) berisi stub protokol v1 (`fixtures/_widget-stub`) sampai aplikasi widget asli ada (W3c).
 */

const SNIPPET = '/fixtures/html-snippet-nonce/';
const ROOT = '#plasgos-webchat-root';

interface Received {
    readonly type: string;
    readonly payload: { readonly name?: string; readonly args?: readonly unknown[]; readonly options?: unknown };
}

/** Pelanggaran CSP dicatat sebelum skrip halaman berjalan (skrip init Playwright tak terkena CSP halaman). */
async function watchProblems(page: Page): Promise<string[]> {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
            console.error(`CSP: ${event.violatedDirective} ${event.blockedURI}`);
        });
    });
    return problems;
}

async function widgetFrame(page: Page): Promise<Frame> {
    await expect.poll(() => page.frames().some((frame) => frame.url().includes('/w/wgt_'))).toBe(true);
    const frame = page.frames().find((candidate) => candidate.url().includes('/w/wgt_'));
    if (!frame) throw new Error('iframe widget tak ditemukan');
    return frame;
}

async function received(frame: Frame): Promise<Received[]> {
    return frame.evaluate(() => (window as unknown as { __received: Received[] }).__received);
}

async function commandsOf(frame: Frame, name: string): Promise<Received[]> {
    return (await received(frame)).filter((message) => message.type === 'host.command' && message.payload.name === name);
}

test('snippet resmi dipasang DUA KALI di bawah CSP nonce → tepat satu widget, handshake v1, tanpa pelanggaran', async ({ page }) => {
    const problems = await watchProblems(page);
    await page.goto(SNIPPET);
    const frame = await widgetFrame(page);

    await expect.poll(async () => (await received(frame)).map((message) => message.type)).toContain('host.init');
    await expect(page.locator(ROOT)).toHaveCount(1);
    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
    await expect(page.locator(`${ROOT} iframe`)).toHaveAttribute('title', 'Jendela chat');
    await expect(page.locator(ROOT)).toHaveCSS('width', '72px');
    const init = (await received(frame)).find((message) => message.type === 'host.init');
    expect(init?.payload.options).toEqual({ widgetId: 'wgt_0123456789abcdef01234567' });
    expect(await page.evaluate(() => (window as unknown as { Plasgos: (name: string) => unknown }).Plasgos('getState')))
        .toMatchObject({ booted: true, open: false });
    expect(problems).toEqual([]);
});

test('Trusted Types wajib + tanpa skrip inline (data-auto-boot) → widget menyala tanpa pelanggaran', async ({ page }) => {
    const problems = await watchProblems(page);
    await page.goto('/fixtures/html-strict-tt/');
    const frame = await widgetFrame(page);

    await expect.poll(async () => (await received(frame)).map((message) => message.type)).toContain('host.init');
    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
    expect(problems).toEqual([]);
});

test('tombol bantuan milik tenant membuka chat; fokus pindah ke jendela chat lalu kembali ke tombol saat ditutup', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(SNIPPET);
    const frame = await widgetFrame(page);
    await expect.poll(async () => (await received(frame)).length).toBeGreaterThan(0);

    await page.click('#bantuan');

    await expect.poll(async () => (await commandsOf(frame, 'open')).length).toBe(1);
    await expect(page.locator(ROOT)).toHaveCSS('height', '600px');
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');

    // Pengunjung menutup dari dalam jendela chat (aktivasi pengguna — syarat peramban memindahkan fokus).
    await frame.click('#tutup');

    await expect(page.locator(ROOT)).toHaveCSS('height', '72px');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('bantuan');
});

test('navigasi SPA (pushState) dilaporkan ke widget beserta judul halaman baru', async ({ page }) => {
    await page.goto(SNIPPET);
    const frame = await widgetFrame(page);
    await expect.poll(async () => (await received(frame)).length).toBeGreaterThan(0);

    await page.click('#ke-produk');

    await expect.poll(async () => (await commandsOf(frame, 'page')).length).toBe(1);
    const [page_] = await commandsOf(frame, 'page');
    expect(page_?.payload.args?.[0]).toMatchObject({ url: expect.stringContaining('/produk'), title: 'Toko Uji — produk' });
});

test('framework mengganti isi <body> → root dipasang ulang dan handshake diulang', async ({ page }) => {
    await page.goto(SNIPPET);
    await widgetFrame(page);
    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);

    await page.evaluate(() => {
        document.body.replaceChildren(Object.assign(document.createElement('main'), { textContent: 'Halaman baru (Turbo)' }));
    });

    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
    const frame = await widgetFrame(page);
    await expect.poll(async () => (await received(frame)).map((message) => message.type)).toContain('host.init');
});

test('layar sempit: chat terbuka layar penuh & mengunci scroll halaman; ditutup → nilai semula kembali', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(SNIPPET);
    const frame = await widgetFrame(page);
    await expect.poll(async () => (await received(frame)).map((message) => message.type)).toContain('host.viewport');

    await page.click('#bantuan');

    await expect(page.locator(ROOT)).toHaveCSS('width', '390px');
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    await page.evaluate(() => {
        (window as unknown as { Plasgos: (name: string) => void }).Plasgos('close');
    });

    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('load: "interaction" → iframe belum dimuat sampai pengunjung berinteraksi', async ({ page }) => {
    await page.goto(`${SNIPPET}?load=interaction`);
    await page.waitForTimeout(1500);
    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(0);

    await page.mouse.click(5, 5);

    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
});

test('domain belum terdaftar (iframe tak pernah ready) → widget dilepas setelah 10 detik dengan peringatan jelas', async ({ page }) => {
    test.setTimeout(30_000);
    const warnings: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'warning') warnings.push(message.text());
    });

    await page.goto(`${SNIPPET}?widget=wgt_000000000000000000000000`);
    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);

    await expect(page.locator(ROOT)).toHaveCount(0, { timeout: 15_000 });
    expect(warnings.some((text) => text.startsWith('[Plasgos Webchat]') && text.includes('domain website'))).toBe(true);
});
