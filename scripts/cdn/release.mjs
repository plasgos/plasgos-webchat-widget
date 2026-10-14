// Rilis CDN berversi (WEBCHAT_DESIGN.md §13.5, K5): susunan berkas, SRI, header cache, catatan rilis.
//
//   loader/<x.y.z>/loader.js · loader/<x.y.z>/element.js · widget-app/<x.y.z>/app.js   → immutable (1 tahun)
//   loader/v<x>/…  · widget-app/v<x>/…                                                 → alias, 5 menit
//   releases/<x.y.z>.json (manifest + SRI) · releases/v<x>.json (versi yang ditunjuk alias)
//
// Versi yang sudah terbit TIDAK PERNAH ditimpa dengan isi lain (website yang mengunci versi + SRI akan rusak);
// rollback = arahkan ulang alias ke versi lama + invalidasi alias saja.
import { createHash } from 'node:crypto';

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const ALIAS_CACHE = 'public, max-age=300';
export const MANIFEST_CACHE = 'no-cache';
const JS_TYPE = 'text/javascript; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

/** Berkas yang terbit ke CDN: sumber hasil build → path di bawah folder versi. Peta sumber TIDAK diterbitkan. */
export const SOURCES = Object.freeze([
    { source: 'packages/loader/dist/loader.js', dir: 'loader', name: 'loader.js' },
    { source: 'packages/webchat/dist/cdn/element.js', dir: 'loader', name: 'element.js' },
    { source: 'packages/widget-app/dist/app.js', dir: 'widget-app', name: 'app.js' },
]);

export function parseVersion(version) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(version));
    if (!match) {
        throw new Error(`versi rilis harus x.y.z (semver tanpa prarilis), dapat "${String(version)}"`);
    }
    const major = Number(match[1]);
    if (major < 1) {
        throw new Error('versi CDN dimulai dari 1.0.0 — alias v0 tak dipakai snippet mana pun');
    }
    return { version: String(version), alias: `v${String(major)}` };
}

export function sriOf(body) {
    return `sha384-${createHash('sha384').update(body).digest('base64')}`;
}

/**
 * Rencana rilis dari isi berkas build. `read(source)` → Buffer. Hasilnya dipakai deploy (urutan: versi dulu,
 * alias kemudian) dan ditulis sebagai manifest rilis.
 */
export async function planRelease({ version, read, builtAt = new Date().toISOString() }) {
    const { alias } = parseVersion(version);
    const files = [];
    for (const entry of SOURCES) {
        const body = await read(entry.source);
        files.push({
            source: entry.source,
            key: `${entry.dir}/${version}/${entry.name}`,
            aliasKey: `${entry.dir}/${alias}/${entry.name}`,
            body,
            size: body.length,
            sri: sriOf(body),
            contentType: JS_TYPE,
        });
    }
    return { version, alias, builtAt, files };
}

/** Manifest rilis (tanpa isi berkas) — `releases/<versi>.json`, dibaca rollback & catatan rilis. */
export function manifestOf(plan) {
    return {
        version: plan.version,
        alias: plan.alias,
        built_at: plan.builtAt,
        files: plan.files.map((file) => ({
            key: file.key,
            alias_key: file.aliasKey,
            size: file.size,
            sri: file.sri,
            content_type: file.contentType,
        })),
    };
}

export function manifestKey(version) {
    return `releases/${version}.json`;
}

export function pointerKey(alias) {
    return `releases/${alias}.json`;
}

export function jsonBody(value) {
    return { body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`), contentType: JSON_TYPE, cacheControl: MANIFEST_CACHE };
}

/** Path CloudFront yang diinvalidasi saat alias berpindah — hanya alias, versi berhash tak pernah berubah. */
export function aliasInvalidationPaths(alias) {
    return [`/loader/${alias}/*`, `/widget-app/${alias}/*`, `/${pointerKey(alias)}`];
}

/** Catatan rilis: SRI per berkas + snippet versi terkunci untuk website yang mewajibkan SRI. */
export function releaseNotes(manifest, cdnOrigin) {
    const origin = cdnOrigin.replace(/\/+$/, '');
    const loader = manifest.files.find((file) => file.key.endsWith('/loader.js'));
    const rows = manifest.files.map((file) => `| \`${file.key}\` | ${String(file.size)} B | \`${file.sri}\` |`);
    return [
        `# Rilis CDN widget webchat ${manifest.version}`,
        '',
        `Dibangun ${manifest.built_at}. Alias \`${manifest.alias}\` menunjuk versi ini setelah deploy.`,
        '',
        '| Berkas | Ukuran | SRI |',
        '|---|---|---|',
        ...rows,
        '',
        'Website yang mewajibkan Subresource Integrity mengunci versi (alias tak bisa diberi SRI karena isinya',
        'berpindah). Bentuk tanpa skrip inline:',
        '',
        '```html',
        `<script async src="${origin}/${loader?.key ?? ''}" integrity="${loader?.sri ?? ''}" crossorigin="anonymous" data-widget-id="wgt_…" data-auto-boot="true"></script>`,
        '```',
        '',
    ].join('\n');
}
