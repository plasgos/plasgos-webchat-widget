// Deploy & rollback rilis CDN di atas target (targets.mjs). Urutan deploy: berkas versi (immutable, ditulis
// bersyarat) → manifest → alias → penunjuk alias → invalidasi alias. Alias hanya berpindah bila SEMUA berkas versi
// sudah ada — website tak pernah melihat alias setengah jadi menunjuk berkas yang belum terbit.
import { ALIAS_CACHE, IMMUTABLE_CACHE, aliasInvalidationPaths, jsonBody, manifestKey, manifestOf, parseVersion, pointerKey } from './release.mjs';

const aliasMeta = (file) => ({ cacheControl: ALIAS_CACHE, contentType: file.content_type, sri: file.sri });

async function publishVersioned(target, file) {
    const existing = await target.head(file.key);
    if (existing) {
        if (existing.sri !== file.sri) {
            throw new Error(`${file.key} sudah terbit dengan isi berbeda (${String(existing.sri)}) — versi terbit tak boleh ditimpa; naikkan versi`);
        }
        return 'sudah ada (isi sama)';
    }
    const meta = { cacheControl: IMMUTABLE_CACHE, contentType: file.contentType, sri: file.sri };
    await target.put(file.key, file.body, meta, { ifNoneMatch: true });
    return 'terbit';
}

async function pointAlias(target, manifest, log) {
    for (const file of manifest.files) {
        await target.copy(file.key, file.alias_key, aliasMeta(file));
        log(`  alias ${file.alias_key} → ${file.key}`);
    }
    const { alias, version } = manifest;
    const pointer = jsonBody({ alias, version, pointed_at: new Date().toISOString() });
    await target.put(pointerKey(manifest.alias), pointer.body, pointer);
    await target.invalidate(aliasInvalidationPaths(manifest.alias));
    log(`  invalidasi ${aliasInvalidationPaths(manifest.alias).join(' ')}`);
}

/** Terbitkan rencana rilis; `moveAlias: false` = terbitkan versi saja (uji canary dengan versi terkunci dulu). */
export async function deployRelease({ plan, target, moveAlias = true, log = console.info }) {
    log(`▶ rilis ${plan.version} → ${target.describe}`);
    for (const file of plan.files) {
        log(`  ${file.key} ${file.sri} — ${await publishVersioned(target, file)}`);
    }
    const manifest = manifestOf(plan);
    const existingManifest = await target.head(manifestKey(plan.version));
    if (!existingManifest) {
        const body = jsonBody(manifest);
        await target.put(manifestKey(plan.version), body.body, body, { ifNoneMatch: true });
    }
    if (moveAlias) await pointAlias(target, manifest, log);
    return manifest;
}

/** Arahkan ulang alias ke versi yang SUDAH terbit (rollback atau maju lagi). */
export async function pointAliasTo({ version, target, log = console.info }) {
    const { alias } = parseVersion(version);
    let manifest;
    try {
        manifest = JSON.parse((await target.read(manifestKey(version))).toString());
    } catch {
        throw new Error(`versi ${version} belum pernah terbit di ${target.describe} (manifest ${manifestKey(version)} tak ada)`);
    }
    for (const file of manifest.files) {
        const head = await target.head(file.key);
        if (head?.sri !== file.sri) throw new Error(`${file.key} hilang atau berbeda dari manifest — alias tak dipindah`);
    }
    log(`▶ alias ${alias} → ${version} di ${target.describe}`);
    await pointAlias(target, manifest, log);
    return manifest;
}

export async function currentAlias({ alias, target }) {
    try {
        return JSON.parse((await target.read(pointerKey(alias))).toString());
    } catch {
        return null;
    }
}
