// Tujuan deploy CDN: S3 + CloudFront (produksi/staging, lewat AWS CLI v2) atau folder lokal (uji & e2e).
// Keduanya berantarmuka sama: head · read · put · copy · invalidate.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Folder lokal berperan bucket; header tiap objek di `.meta/<key>.json` (dibaca server fixture `/cdn/*`). */
export function fileTarget(root) {
    const dir = resolve(root);
    const metaPath = (key) => join(dir, '.meta', `${key}.json`);
    const head = async (key) => {
        try {
            return JSON.parse(await readFile(metaPath(key), 'utf8'));
        } catch {
            return null;
        }
    };
    const put = async (key, body, meta, { ifNoneMatch = false } = {}) => {
        if (ifNoneMatch && (await head(key))) {
            throw new Error(`objek ${key} sudah ada (penulisan bersyarat ditolak)`);
        }
        await mkdir(dirname(join(dir, key)), { recursive: true });
        await mkdir(dirname(metaPath(key)), { recursive: true });
        await writeFile(join(dir, key), body);
        await writeFile(metaPath(key), JSON.stringify(meta));
    };
    return {
        describe: `file://${dir}`,
        head,
        read: (key) => readFile(join(dir, key)),
        put,
        copy: async (fromKey, toKey, meta) => {
            await put(toKey, await readFile(join(dir, fromKey)), meta);
        },
        invalidate: async (paths) => {
            await mkdir(join(dir, '.meta'), { recursive: true });
            await appendFile(join(dir, '.meta', 'invalidations.log'), `${JSON.stringify({ at: new Date().toISOString(), paths })}\n`);
        },
    };
}

function awsRunner() {
    return (args) => {
        const result = spawnSync('aws', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
        if (result.error) {
            throw new Error(`AWS CLI tak bisa dijalankan (${result.error.message}) — pasang AWS CLI v2 & kredensial`);
        }
        return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr.toString() };
    };
}

/**
 * S3 privat (Origin Access Control) + CloudFront. `run(args)` = pemanggil AWS CLI (dapat diganti di test).
 * Metadata `sri` disimpan di objek supaya deploy berikutnya bisa membuktikan versi terbit tak berubah isi.
 */
export function s3Target({ bucket, distributionId, run = awsRunner() }) {
    if (!bucket) throw new Error('bucket S3 wajib (--target s3://<bucket>)');
    const call = (args) => {
        const result = run(args);
        if (result.status !== 0) throw new Error(`aws ${args.slice(0, 2).join(' ')} gagal: ${result.stderr.trim()}`);
        return result.stdout;
    };
    const metaArgs = (meta) => ['--cache-control', meta.cacheControl, '--content-type', meta.contentType, ...(meta.sri ? ['--metadata', `sri=${meta.sri}`] : [])];
    return {
        describe: `s3://${bucket}${distributionId ? ` (CloudFront ${distributionId})` : ''}`,
        head: (key) => {
            const result = run(['s3api', 'head-object', '--bucket', bucket, '--key', key, '--output', 'json']);
            if (result.status !== 0) {
                if (/Not Found|404/.test(result.stderr)) return Promise.resolve(null);
                throw new Error(`aws s3api head-object gagal: ${result.stderr.trim()}`);
            }
            const head = JSON.parse(result.stdout.toString());
            return Promise.resolve({
                sri: head.Metadata?.sri ?? null,
                cacheControl: head.CacheControl,
                contentType: head.ContentType,
            });
        },
        read: (key) => Promise.resolve(call(['s3', 'cp', `s3://${bucket}/${key}`, '-'])),
        put: (key, body, meta, { ifNoneMatch = false } = {}) => {
            const tmp = mkdtempSync(join(tmpdir(), 'plasgos-cdn-'));
            try {
                const file = join(tmp, 'body');
                writeFileSync(file, body);
                call(['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', file, ...metaArgs(meta), ...(ifNoneMatch ? ['--if-none-match', '*'] : [])]);
            } finally {
                rmSync(tmp, { recursive: true, force: true });
            }
            return Promise.resolve();
        },
        copy: (fromKey, toKey, meta) => {
            call(['s3api', 'copy-object', '--bucket', bucket, '--copy-source', `${bucket}/${fromKey}`, '--key', toKey, '--metadata-directive', 'REPLACE', ...metaArgs(meta)]);
            return Promise.resolve();
        },
        invalidate: (paths) => {
            if (!distributionId) {
                console.warn('[cdn] tanpa --distribution: invalidasi CloudFront dilewati — alias berlaku setelah cache 5 menit habis');
                return Promise.resolve();
            }
            call(['cloudfront', 'create-invalidation', '--distribution-id', distributionId, '--paths', ...paths]);
            return Promise.resolve();
        },
    };
}

/** `file://<folder>` atau `s3://<bucket>`. */
export function targetOf(url, { distributionId, run } = {}) {
    if (url.startsWith('file://')) return fileTarget(url.slice('file://'.length));
    if (url.startsWith('s3://')) return s3Target({ bucket: url.slice('s3://'.length).replace(/\/+$/, ''), distributionId, run });
    throw new Error(`target harus file://<folder> atau s3://<bucket>, dapat "${url}"`);
}
