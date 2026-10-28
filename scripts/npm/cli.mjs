// CLI rilis npm (docs/RELEASE.md "Rilis npm"):
//   pnpm npm-release check   [--tag npm-vX.Y.Z]   versi kelima paket sama (dan sama dengan tag)
//   pnpm npm-release pack    [--tag npm-vX.Y.Z]   kemas hasil `pnpm build` → .npm-packs/<paket>.tgz
//   pnpm npm-release publish [--tag npm-vX.Y.Z]   terbitkan .npm-packs berurutan; versi yang sudah ada dilewati
// Login: CI memakai npm Trusted Publishing (OIDC); terbit pertama dari laptop memakai `npm login` + 2FA.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { NPM_PACKAGES, planPublish, releaseVersionOf } from './release.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PACKS_DIR = join(ROOT, '.npm-packs');
const { positionals, values } = parseArgs({ allowPositionals: true, options: { tag: { type: 'string' } } });
const command = positionals[0];

const manifests = NPM_PACKAGES.map((dir) => {
    const { name, version } = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'));
    return { dir, name, version };
});
const tarballOf = (dir) => join(PACKS_DIR, `${dir}.tgz`);

const run = (bin, args, cwd) => {
    const result = spawnSync(bin, args, { cwd, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${bin} ${args.join(' ')} gagal (kode ${result.status ?? result.signal})`);
};

/** `pnpm pack` mengganti `workspace:*` dengan versi rilis — `npm pack` tidak, jadi jangan dipakai di sini. */
function pack() {
    rmSync(PACKS_DIR, { recursive: true, force: true });
    mkdirSync(PACKS_DIR, { recursive: true });
    for (const { dir, name } of manifests) {
        const packageDir = join(ROOT, 'packages', dir);
        if (!existsSync(join(packageDir, 'dist'))) throw new Error(`${name}: dist/ belum ada — jalankan pnpm build dulu`);
        // LICENSE tinggal di akar repo; disalin sementara supaya ikut tarball (`license` paket merujuk berkas ini).
        copyFileSync(join(ROOT, 'LICENSE'), join(packageDir, 'LICENSE'));
        try {
            run('pnpm', ['pack', '--out', tarballOf(dir)], packageDir);
        } finally {
            rmSync(join(packageDir, 'LICENSE'), { force: true });
        }
    }
}

function publish(version) {
    const isPublished = (name) => {
        const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' });
        return result.status === 0 && result.stdout.trim() === version;
    };
    for (const { dir, name, skip } of planPublish(manifests, isPublished)) {
        if (skip) {
            console.info(`= ${name}@${version} sudah terbit, dilewati`);
            continue;
        }
        if (!existsSync(tarballOf(dir))) throw new Error(`${tarballOf(dir)} belum ada — jalankan pnpm npm-release pack dulu`);
        run('npm', ['publish', tarballOf(dir), '--access', 'public'], ROOT);
    }
}

function main() {
    const version = releaseVersionOf(manifests, values.tag);
    switch (command) {
        case 'check':
            console.info(`versi paket npm: ${version} (${manifests.map(({ name }) => name).join(', ')})`);
            return;
        case 'pack':
            pack();
            return;
        case 'publish':
            publish(version);
            return;
        default:
            throw new Error('perintah: check | pack | publish');
    }
}

try {
    main();
} catch (error) {
    console.error(`npm-release: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
