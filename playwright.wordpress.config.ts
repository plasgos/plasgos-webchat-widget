import { defineConfig, devices } from '@playwright/test';

/**
 * Fixture WordPress (§7, W9a): situs WordPress sungguhan di Docker dengan plugin Plasgos CRM (repo tetangga
 * `plasgos-wordpress`) yang memasang widget. Iframe widget = stub protokol v1 di server fixture (127.0.0.1:4400).
 * Butuh Docker + `composer install` di folder plugin. `KEEP=1` membiarkan situs menyala (http://localhost:4518, admin/admin).
 */
const chromiumChannel = process.env['PW_CHROMIUM_CHANNEL'];

export default defineConfig({
    testDir: 'e2e-wordpress',
    globalTeardown: './e2e-wordpress/teardown.ts',
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
        {
            command: 'bash fixtures/apps/wordpress/start.sh',
            // Siap = baris terakhir start.sh, bukan URL (WordPress belum terpasang menjawab 302 ke install.php).
            wait: { stdout: /WordPress siap/ },
            stdout: 'pipe',
            reuseExistingServer: false,
            timeout: 300_000,
        },
    ],
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(chromiumChannel ? { channel: chromiumChannel } : {}) } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
});
