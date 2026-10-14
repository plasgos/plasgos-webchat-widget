// Matriks meta-framework (§7): kemas paket npm (`pnpm pack` = isi yang dipublikasikan, `workspace:*` sudah
// diganti versi) lalu instal & bangun produksi tiap aplikasi di fixtures/apps/* — di luar workspace utama, seperti
// website tenant memasang dari registry (satu salinan React/Vue/… milik aplikasi). `APPS=next15,nuxt3` membatasi.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPS_DIR = join(ROOT, 'fixtures/apps');
const PACKS_DIR = join(APPS_DIR, '.packs');
const PACKAGES = ['webchat', 'react', 'vue', 'angular', 'svelte'];
const wanted = (process.env.APPS ?? '').split(',').map((name) => name.trim()).filter(Boolean);

const run = (command, cwd) => {
    execSync(command, { cwd, stdio: 'inherit' });
};

rmSync(PACKS_DIR, { recursive: true, force: true });
mkdirSync(PACKS_DIR, { recursive: true });
for (const name of PACKAGES) {
    run(`pnpm pack --out ${join(PACKS_DIR, `${name}.tgz`)}`, join(ROOT, 'packages', name));
}

for (const name of readdirSync(APPS_DIR)) {
    const dir = join(APPS_DIR, name);
    if (!existsSync(join(dir, 'package.json')) || (wanted.length && !wanted.includes(name))) continue;
    console.info(`▶ ${name}: instal & build`);
    // Tarball berubah tiap kemasan → tanpa lockfile (versi framework sudah dipin persis di package.json).
    rmSync(join(dir, 'node_modules/@plasgos'), { recursive: true, force: true });
    run('pnpm install --ignore-workspace --config.lockfile=false', dir);
    run('pnpm build', dir);
}
