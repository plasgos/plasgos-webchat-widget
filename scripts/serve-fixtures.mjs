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
