// Server statis untuk fixture e2e & Lighthouse. Header per fixture dibaca dari `fixtures/<nama>/headers.json`
// (mis. CSP ketat), supaya fixture menguji aturan keamanan website tenant sungguhan. Hanya untuk uji lokal/CI.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.FIXTURE_PORT || 4400);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.map': 'application/json', '.json': 'application/json', '.css': 'text/css' };
// Hanya folder ini yang boleh dilayani — bukan seluruh repo.
const SERVED = ['fixtures', 'packages/loader/dist', 'packages/widget-app/dist', 'packages/webchat/dist'];
// Bucket CDN lokal (`pnpm cdn deploy --target file://.cdn-local`) dilayani di `/cdn/*` dengan header objeknya.
const CDN_DIR = resolve(ROOT, process.env.CDN_LOCAL_DIR || '.cdn-local');

/** Peran CloudFront: header objek (Cache-Control, Content-Type) + CORS terbuka — wajib agar SRI lintas origin jalan. */
async function serveCdn(key, res) {
    if (key.startsWith('.meta/') || key.split('/').includes('..')) {
        res.writeHead(404).end('not found');
        return;
    }
    try {
        const meta = JSON.parse(await readFile(join(CDN_DIR, '.meta', `${key}.json`), 'utf8'));
        const body = await readFile(join(CDN_DIR, key));
        res.writeHead(200, {
            'content-type': meta.contentType,
            'cache-control': meta.cacheControl,
            'access-control-allow-origin': '*',
            'x-content-type-options': 'nosniff',
        });
        res.end(body);
    } catch {
        res.writeHead(404, { 'access-control-allow-origin': '*' }).end('not found');
    }
}

async function headersOf(path) {
    const match = /^fixtures\/([^/]+)\//.exec(path);
    if (!match) return {};
    try {
        return JSON.parse(await readFile(join(ROOT, 'fixtures', match[1], 'headers.json'), 'utf8'));
    } catch {
        return {};
    }
}

createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
    // Peramban selalu meminta favicon — dijawab kosong supaya tak muncul galat 404 di console fixture.
    if (path === 'favicon.ico') {
        res.writeHead(204).end();
        return;
    }
    if (path.startsWith('cdn/')) {
        await serveCdn(path.slice('cdn/'.length), res);
        return;
    }
    // Peran CDN untuk uji live terhadap api-crm dev: `WEBCHAT_CDN_ORIGIN` api-crm diarahkan ke server ini, lalu
    // dokumen iframe memuat `${CDN}/widget-app/v1/app.js` = hasil build paket widget-app.
    const cdnAsset = /^widget-app\/v1\/(app\.js(?:\.map)?)$/.exec(path);
    if (cdnAsset) path = `packages/widget-app/dist/${cdnAsset[1]}`;
    // Snippet resmi & konsol UAT api-crm (mode widget asli) memuat `${CDN}/loader/v1/loader.js`.
    const loaderAsset = /^loader\/v1\/(loader\.js(?:\.map)?|element\.js)$/.exec(path);
    if (loaderAsset) path = loaderAsset[1] === 'element.js' ? 'packages/webchat/dist/cdn/element.js' : `packages/loader/dist/${loaderAsset[1]}`;
    // Dokumen iframe widget (`/w/:widget_id`) — dilayani stub uji loader sampai aplikasi widget asli (W3c).
    if (/^w\/wgt_[0-9a-f]{24}$/.test(path)) path = 'fixtures/_widget-stub/index.html';
    if (path.endsWith('/') || path === '') path += 'index.html';
    if (!SERVED.some((dir) => path.startsWith(`${dir}/`))) {
        res.writeHead(404).end('not found');
        return;
    }
    const file = join(ROOT, path);
    try {
        if (!(await stat(file)).isFile()) throw new Error('bukan berkas');
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...(await headersOf(path)) });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
}).listen(PORT, () => console.info(`fixture server http://localhost:${PORT}`));
