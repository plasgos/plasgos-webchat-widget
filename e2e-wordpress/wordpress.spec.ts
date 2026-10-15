import { expect, test } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';

/**
 * Plugin WordPress Plasgos CRM di situs WordPress sungguhan (tema blok bawaan): snippet resmi dari `wp_footer`,
 * pelanggan yang login dikenali (token identitas dari server WordPress), logout = `identityToken: null`, tombol
 * shortcode membuka chat. Halaman WordPress dimuat penuh (bukan navigasi klien) — iframe memang dimuat ulang.
 */
const BASE = 'http://localhost:4518';
const ROOT = '#plasgos-webchat-root';

interface Received {
    readonly type: string;
    readonly payload: { readonly name?: string; readonly args?: readonly { readonly token?: string | null }[] };
}

function widgetFrame(page: Page): Frame | undefined {
    return page.frames().filter((frame) => frame.url().includes('/w/wgt_') && !frame.isDetached()).pop();
}

async function received(page: Page): Promise<Received[]> {
    const frame = widgetFrame(page);
    return frame ? frame.evaluate(() => (window as unknown as { __received?: Received[] }).__received ?? []) : [];
}

async function identifyArgs(page: Page): Promise<unknown[]> {
    await expect.poll(async () => (await received(page)).some((message) => message.payload.name === 'identify')).toBe(true);
    return (await received(page)).filter((message) => message.payload.name === 'identify').map((message) => message.payload.args?.[0]?.token);
}

function watchProblems(page: Page): string[] {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`${message.type()}: ${message.text()}`);
    });
    return problems;
}

test('pengunjung tamu: satu widget dari iframe origin widget, "tak ada yang login" (identify null), tanpa galat', async ({ page }) => {
    const problems = watchProblems(page);
    await page.goto(`${BASE}/`);
    // Loader disuntik setelah `load` (gambar & font tema ikut ditunggu) lalu menunggu idle.
    await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(`${ROOT} iframe`)).toHaveAttribute('src', 'http://127.0.0.1:4400/w/wgt_0123456789abcdef01234567');
    await expect.poll(async () => (await received(page)).map((message) => message.type)).toContain('host.init');
    expect(await identifyArgs(page)).toEqual([null]);
    expect(problems).toEqual([]);
});

test('tombol shortcode [plasgos_webchat] membuka chat', async ({ page }) => {
    await page.goto(`${BASE}/produk/`);
    await expect.poll(async () => (await received(page)).map((message) => message.type)).toContain('host.init');
    await page.getByRole('button', { name: 'Tanya stok' }).click();
    await expect.poll(async () => (await received(page)).some((message) => message.payload.name === 'open')).toBe(true);
});

test('pelanggan login → token identitas; navigasi halaman penuh → token baru; logout → identify null', async ({ page }) => {
    await page.goto(`${BASE}/wp-login.php`);
    await page.fill('#user_login', 'admin');
    await page.fill('#user_pass', 'admin');
    await page.click('#wp-submit');
    await page.waitForURL(/wp-admin/);

    await page.goto(`${BASE}/`);
    const [first] = await identifyArgs(page);
    expect(typeof first).toBe('string');
    const claims = JSON.parse(Buffer.from(String(first).split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(claims).toMatchObject({ email: 'admin@contoh.id', wid: 'wgt_0123456789abcdef01234567' });
    expect(String(claims['sub'])).toMatch(/^wp-[0-9a-f]{10}-1$/);

    await page.click('#ke-produk');
    await expect(page).toHaveURL(`${BASE}/produk/`);
    const [second] = await identifyArgs(page);
    expect(typeof second).toBe('string');
    expect(second).not.toBe(first);

    await page.goto(`${BASE}/wp-admin/`);
    const logout = await page.locator('#wp-admin-bar-logout a').getAttribute('href');
    await page.goto(String(logout));
    await page.goto(`${BASE}/`);
    expect(await identifyArgs(page)).toEqual([null]);
});
