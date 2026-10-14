import { expect, test } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';

import { selectedApps } from './apps';

const ROOT = '#plasgos-webchat-root';

interface Received {
    readonly type: string;
    readonly payload: { readonly name?: string; readonly args?: readonly { readonly url?: string }[] };
}

function widgetFrame(page: Page): Frame | undefined {
    return page.frames().filter((frame) => frame.url().includes('/w/wgt_') && !frame.isDetached()).pop();
}

async function received(page: Page): Promise<Received[]> {
    const frame = widgetFrame(page);
    if (!frame) return [];
    return frame.evaluate(() => (window as unknown as { __received?: Received[] }).__received ?? []);
}

async function pageCommands(page: Page): Promise<Received[]> {
    return (await received(page)).filter((message) => message.type === 'host.command' && message.payload.name === 'page');
}

/** Galat & peringatan hidrasi React/Vue/Svelte/Angular muncul sebagai console error/warning di produksi. */
function watchProblems(page: Page): string[] {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error' || /hydrat/i.test(text)) problems.push(`${message.type()}: ${text}`);
    });
    return problems;
}

for (const app of selectedApps()) {
    for (const entry of app.entries) {
        test(`${app.name} ${entry.label}: SSR tanpa galat, satu widget, navigasi klien dilaporkan sekali`, async ({ page }) => {
            const problems = watchProblems(page);
            const base = `http://localhost:${String(app.port)}`;
            await page.goto(`${base}${entry.path}`);

            await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
            await expect.poll(async () => (await received(page)).map((message) => message.type)).toContain('host.init');

            await page.click(entry.link);
            await expect(page).toHaveURL(`${base}${entry.target}`);

            await expect.poll(async () => (await pageCommands(page)).length).toBe(1);
            await page.waitForTimeout(800);
            const pages = await pageCommands(page);
            expect(pages).toHaveLength(1);
            expect(pages[0]?.payload.args?.[0]?.url).toBe(`${base}${entry.target}`);
            await expect(page.locator(`${ROOT} iframe`)).toHaveCount(1);
            expect(problems).toEqual([]);
        });
    }
}
