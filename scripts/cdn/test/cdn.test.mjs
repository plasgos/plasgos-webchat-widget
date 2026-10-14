// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentAlias, deployRelease, pointAliasTo } from '../deploy.mjs';
import { ALIAS_CACHE, IMMUTABLE_CACHE, parseVersion, planRelease, releaseNotes, sriOf } from '../release.mjs';
import { fileTarget, s3Target } from '../targets.mjs';

const quiet = () => undefined;

/** Isi build palsu per versi — isi berbeda supaya alias terbukti menunjuk versi yang benar. */
function planOf(version, marker = version) {
    return planRelease({ version, builtAt: '2026-10-14T00:00:00.000Z', read: (source) => Promise.resolve(Buffer.from(`/* ${source} ${marker} */`)) });
}

describe('rilis CDN berversi', () => {
    let dir;
    let target;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'cdn-test-'));
        target = fileTarget(dir);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('versi x.y.z mulai 1.0.0; alias = v<major>', () => {
        expect(parseVersion('1.4.2')).toEqual({ version: '1.4.2', alias: 'v1' });
        expect(() => parseVersion('0.9.0')).toThrow('1.0.0');
        expect(() => parseVersion('1.0.0-rc.1')).toThrow('x.y.z');
    });

    it('deploy: berkas versi immutable + SRI, alias 5 menit menunjuk versi, invalidasi hanya alias', async () => {
        const plan = await planOf('1.0.0');
        await deployRelease({ plan, target, log: quiet });

        const loader = plan.files.find((file) => file.key === 'loader/1.0.0/loader.js');
        expect(loader?.sri).toBe(sriOf(readFileSync(join(dir, 'loader/1.0.0/loader.js'))));
        expect(await target.head('loader/1.0.0/loader.js')).toMatchObject({ cacheControl: IMMUTABLE_CACHE, sri: loader?.sri });
        expect(await target.head('loader/v1/loader.js')).toMatchObject({ cacheControl: ALIAS_CACHE });
        expect(readFileSync(join(dir, 'widget-app/v1/app.js'), 'utf8')).toContain('1.0.0');
        expect(await currentAlias({ alias: 'v1', target })).toMatchObject({ version: '1.0.0' });
        const invalidation = JSON.parse(readFileSync(join(dir, '.meta/invalidations.log'), 'utf8').trim());
        expect(invalidation.paths).toEqual(['/loader/v1/*', '/widget-app/v1/*', '/releases/v1.json']);
    });

    it('versi terbit TIDAK pernah ditimpa isi lain; deploy ulang isi sama aman (idempoten)', async () => {
        await deployRelease({ plan: await planOf('1.0.0'), target, log: quiet });
        await deployRelease({ plan: await planOf('1.0.0'), target, log: quiet });

        await expect(deployRelease({ plan: await planOf('1.0.0', 'isi-lain'), target, log: quiet })).rejects.toThrow('naikkan versi');
        expect(readFileSync(join(dir, 'loader/1.0.0/loader.js'), 'utf8')).toContain('1.0.0 */');
    });

    it('rollback: alias kembali ke versi lama (isi & header alias); versi baru tetap ada untuk maju lagi', async () => {
        await deployRelease({ plan: await planOf('1.0.0'), target, log: quiet });
        await deployRelease({ plan: await planOf('1.1.0'), target, log: quiet });
        expect(readFileSync(join(dir, 'loader/v1/loader.js'), 'utf8')).toContain('1.1.0');

        await pointAliasTo({ version: '1.0.0', target, log: quiet });

        expect(readFileSync(join(dir, 'loader/v1/loader.js'))).toEqual(readFileSync(join(dir, 'loader/1.0.0/loader.js')));
        expect(await target.head('widget-app/v1/app.js')).toMatchObject({ cacheControl: ALIAS_CACHE });
        expect(await currentAlias({ alias: 'v1', target })).toMatchObject({ version: '1.0.0' });
        expect(readFileSync(join(dir, 'loader/1.1.0/loader.js'), 'utf8')).toContain('1.1.0');
        await expect(pointAliasTo({ version: '1.2.0', target, log: quiet })).rejects.toThrow('belum pernah terbit');
    });

    it('--no-alias: versi terbit untuk uji terkunci, alias tetap di versi lama', async () => {
        await deployRelease({ plan: await planOf('1.0.0'), target, log: quiet });
        await deployRelease({ plan: await planOf('1.1.0'), target, moveAlias: false, log: quiet });

        expect(await currentAlias({ alias: 'v1', target })).toMatchObject({ version: '1.0.0' });
        expect(readFileSync(join(dir, 'loader/1.1.0/loader.js'), 'utf8')).toContain('1.1.0');
    });

    it('catatan rilis memuat SRI & snippet versi terkunci', async () => {
        const manifest = await deployRelease({ plan: await planOf('1.0.0'), target, log: quiet });
        const notes = releaseNotes(manifest, 'https://cdn.plasgoschat.com/');

        expect(notes).toContain(`src="https://cdn.plasgoschat.com/loader/1.0.0/loader.js" integrity="${manifest.files[0]?.sri ?? ''}" crossorigin="anonymous"`);
    });

    it('S3: tulis versi bersyarat (--if-none-match), alias copy-object berheader alias, invalidasi CloudFront', async () => {
        const calls = [];
        const run = (args) => {
            calls.push(args);
            if (args[1] === 'head-object') return { status: 254, stdout: Buffer.alloc(0), stderr: 'An error occurred (404) when calling the HeadObject operation: Not Found' };
            if (args[0] === 's3' && args[1] === 'cp') return { status: 0, stdout: Buffer.from('{}'), stderr: '' };
            return { status: 0, stdout: Buffer.alloc(0), stderr: '' };
        };
        await deployRelease({ plan: await planOf('1.0.0'), target: s3Target({ bucket: 'plasgos-webchat-cdn', distributionId: 'E2ABC', run }), log: quiet });

        const put = calls.find((args) => args[1] === 'put-object' && args.includes('loader/1.0.0/loader.js'));
        expect(put).toEqual(expect.arrayContaining(['--if-none-match', '*', '--cache-control', IMMUTABLE_CACHE, '--content-type', 'text/javascript; charset=utf-8']));
        const copy = calls.find((args) => args[1] === 'copy-object' && args.includes('loader/v1/loader.js'));
        expect(copy).toEqual(expect.arrayContaining(['--copy-source', 'plasgos-webchat-cdn/loader/1.0.0/loader.js', '--metadata-directive', 'REPLACE', '--cache-control', ALIAS_CACHE]));
        expect(calls.find((args) => args[0] === 'cloudfront')).toEqual(['cloudfront', 'create-invalidation', '--distribution-id', 'E2ABC', '--paths', '/loader/v1/*', '/widget-app/v1/*', '/releases/v1.json']);
    });
});
