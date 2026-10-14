// CLI rilis CDN (docs/RELEASE.md):
//   pnpm cdn plan
//   pnpm cdn deploy --target s3://<bucket> --distribution <id> [--no-alias] [--notes <berkas.md>]
//   pnpm cdn alias  --target s3://<bucket> --distribution <id> --to <x.y.z>      (rollback / maju lagi)
//   pnpm cdn status --target s3://<bucket> [--alias v1]
// Versi = `version` package.json akar. `--version` hanya untuk target file:// (uji).
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { currentAlias, deployRelease, pointAliasTo } from './deploy.mjs';
import { planRelease, releaseNotes } from './release.mjs';
import { targetOf } from './targets.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
        target: { type: 'string' },
        distribution: { type: 'string' },
        to: { type: 'string' },
        alias: { type: 'string', default: 'v1' },
        version: { type: 'string' },
        notes: { type: 'string' },
        'no-alias': { type: 'boolean', default: false },
    },
});
const command = positionals[0];

function releaseVersion() {
    const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    if (!values.version) return declared;
    if (!values.target?.startsWith('file://')) throw new Error('--version hanya untuk target file:// (uji); rilis sungguhan memakai versi package.json');
    return values.version;
}

/** Loader membawa origin aplikasi widget yang ditanam saat build — deploy ke lingkungan yang salah dicegah di sini. */
function assertBuiltForEnvironment() {
    const expected = process.env.PLASGOS_WIDGET_ORIGIN;
    if (!expected) {
        if (values.target?.startsWith('file://')) return;
        throw new Error('PLASGOS_WIDGET_ORIGIN wajib saat deploy (origin aplikasi widget lingkungan tujuan), lalu build ulang dengan nilai yang sama');
    }
    const loader = readFileSync(join(ROOT, 'packages/loader/dist/loader.js'), 'utf8');
    if (!loader.includes(JSON.stringify(expected).slice(1, -1))) {
        throw new Error(`loader.js tidak dibangun untuk ${expected} — jalankan PLASGOS_WIDGET_ORIGIN=${expected} pnpm build dulu`);
    }
}

const target = () => {
    if (!values.target) throw new Error('--target wajib (s3://<bucket> atau file://<folder>)');
    return targetOf(values.target, { distributionId: values.distribution });
};

const currentPlan = () => planRelease({ version: releaseVersion(), read: (source) => readFile(join(ROOT, source)) });

async function main() {
    switch (command) {
        case 'plan': {
            const plan = await currentPlan();
            for (const file of plan.files) console.info(`${file.key}\t${String(file.size)} B\t${file.sri}`);
            return;
        }
        case 'deploy': {
            assertBuiltForEnvironment();
            const plan = await currentPlan();
            const manifest = await deployRelease({ plan, target: target(), moveAlias: !values['no-alias'] });
            if (values.notes) {
                writeFileSync(values.notes, releaseNotes(manifest, process.env.PLASGOS_CDN_ORIGIN ?? 'https://cdn.plasgoschat.com'));
                console.info(`catatan rilis → ${values.notes}`);
            }
            return;
        }
        case 'alias': {
            if (!values.to) throw new Error('--to <x.y.z> wajib');
            await pointAliasTo({ version: values.to, target: target() });
            return;
        }
        case 'status': {
            console.info(JSON.stringify(await currentAlias({ alias: values.alias, target: target() }), null, 2));
            return;
        }
        default:
            throw new Error('perintah: plan | deploy | alias | status');
    }
}

main().catch((error) => {
    console.error(`[cdn] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
