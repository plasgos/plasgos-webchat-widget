import { defineConfig, devices } from '@playwright/test';

/**
 * Uji LIVE: loader + aplikasi widget asli terhadap api-crm dev (REST, socket, inbox sungguhan). Tidak dijalankan CI
 * (butuh api-crm & token tenant) — lihat README bagian "Uji live terhadap api-crm".
 */
const PORT = Number(process.env['FIXTURE_PORT'] ?? 4400);
const chromiumChannel = process.env['PW_CHROMIUM_CHANNEL'];

export default defineConfig({
    testDir: 'e2e-live',
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    reporter: 'list',
    use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
    webServer: {
        command: 'node scripts/serve-fixtures.mjs',
        url: `http://localhost:${PORT}/fixtures/html-empty/`,
        reuseExistingServer: true,
        env: { FIXTURE_PORT: String(PORT) },
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(chromiumChannel ? { channel: chromiumChannel } : {}) } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
});
