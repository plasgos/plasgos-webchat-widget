import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Playwright menghentikan `start.sh` tanpa sempat menjalankan `trap` — kontainer & volume dibongkar di sini. */
export default function teardown(): void {
    if (process.env['KEEP'] === '1') return;
    const compose = fileURLToPath(new URL('../fixtures/apps/wordpress/compose.yml', import.meta.url));
    execFileSync('docker', ['compose', '-f', compose, 'down', '-v'], { stdio: 'ignore', env: { ...process.env, PLASGOS_WORDPRESS_DIR: process.env['PLASGOS_WORDPRESS_DIR'] ?? '.' } });
}
