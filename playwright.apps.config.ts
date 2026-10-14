import { defineConfig, devices } from '@playwright/test';

import { selectedApps } from './e2e-apps/apps';

/**
 * Matriks meta-framework (§7): aplikasi Next/Remix/Nuxt/Angular SSR/SvelteKit/Astro yang SUDAH dibangun produksi
 * (`pnpm apps:build`). Iframe widget = stub protokol v1 di server fixture (127.0.0.1:4400).
 */
const chromiumChannel = process.env['PW_CHROMIUM_CHANNEL'];

export default defineConfig({
    testDir: 'e2e-apps',
    timeout: 60_000,
    reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: { trace: 'retain-on-failure' },
    webServer: [
        {
            command: 'node scripts/serve-fixtures.mjs',
            url: 'http://localhost:4400/fixtures/html-empty/',
            reuseExistingServer: !process.env['CI'],
            env: { FIXTURE_PORT: '4400' },
        },
        ...selectedApps().map((app) => ({
            command: app.start,
            url: `http://localhost:${String(app.port)}${app.entries[0]?.path ?? '/'}`,
            reuseExistingServer: !process.env['CI'],
            timeout: 120_000,
        })),
    ],
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(chromiumChannel ? { channel: chromiumChannel } : {}) } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
});
