import { expect, test } from '@playwright/test';

/**
 * Garis dasar W3a: fixture website tenant dengan CSP ketat (tanpa unsafe-inline/eval, Trusted Types wajib) termuat
 * tanpa pelanggaran CSP dan tanpa galat console. Fixture berikutnya (loader, widget, framework) memakai pola sama.
 */
test('fixture HTML kosong termuat di bawah CSP ketat tanpa pelanggaran', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    const response = await page.goto('/fixtures/html-empty/');

    expect(response?.headers()['content-security-policy']).toContain("require-trusted-types-for 'script'");
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Website tenant tanpa widget');
    expect(problems).toEqual([]);
});
