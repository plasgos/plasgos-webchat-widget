import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['FIXTURE_PORT'] ?? 4400);
// Lokal boleh memakai Chrome terpasang (`PW_CHROMIUM_CHANNEL=chrome`); CI memakai browser bawaan Playwright.
const chromiumChannel = process.env['PW_CHROMIUM_CHANNEL'];

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    forbidOnly: Boolean(process.env['CI']),
    retries: process.env['CI'] ? 1 : 0,
    reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
    webServer: {
        command: 'node scripts/serve-fixtures.mjs',
        url: `http://localhost:${PORT}/fixtures/html-empty/`,
        reuseExistingServer: !process.env['CI'],
        env: { FIXTURE_PORT: String(PORT) },
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(chromiumChannel ? { channel: chromiumChannel } : {}) } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        { name: 'iphone', use: { ...devices['iPhone 14'] } },
        { name: 'android', use: { ...devices['Pixel 7'], ...(chromiumChannel ? { channel: chromiumChannel } : {}) } },
    ],
});
