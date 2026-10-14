import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/**
 * Bucket CDN lokal untuk `e2e/cdn.spec.ts`: terbitkan 1.0.0 lalu 1.1.0 dari hasil build, kemudian ROLLBACK alias v1
 * ke 1.0.0 — lewat CLI rilis yang sama dengan produksi (target file://).
 */
export default function globalSetup(): void {
    rmSync('.cdn-local', { recursive: true, force: true });
    const cdn = (...args: string[]): void => {
        execFileSync('node', ['scripts/cdn/cli.mjs', ...args, '--target', 'file://.cdn-local'], { stdio: 'pipe' });
    };
    cdn('deploy', '--version', '1.0.0');
    cdn('deploy', '--version', '1.1.0');
    cdn('alias', '--to', '1.0.0');
}
