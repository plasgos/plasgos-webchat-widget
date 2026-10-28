// Rilis npm paket @plasgos/webchat* (docs/RELEASE.md "Rilis npm"). Kelima paket berversi sama dan terbit
// berurutan: paket inti dulu, karena wrapper bergantung padanya. Versi yang sudah terbit dilewati, jadi job yang
// gagal di tengah aman dijalankan ulang.

/** Folder di packages/, dalam urutan terbit. */
export const NPM_PACKAGES = ['webchat', 'react', 'vue', 'angular', 'svelte'];

const VERSION = /^\d+\.\d+\.\d+$/;
const TAG_PREFIX = 'npm-v';

/** `npm-v1.2.3` → `1.2.3`. */
export function versionFromTag(tag) {
    const version = tag.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : '';
    if (!VERSION.test(version)) throw new Error(`tag rilis npm harus ${TAG_PREFIX}X.Y.Z — dapat "${tag}"`);
    return version;
}

/**
 * Versi rilis = versi yang sama di semua paket (dan di tag, bila ada).
 * @param {{ name: string, version: string }[]} manifests
 * @param {string} [tag]
 */
export function releaseVersionOf(manifests, tag) {
    const expected = tag ? versionFromTag(tag) : manifests[0].version;
    if (!VERSION.test(expected)) throw new Error(`versi paket npm harus X.Y.Z — dapat "${expected}"`);
    const wrong = manifests.filter((manifest) => manifest.version !== expected);
    if (wrong.length) {
        const list = wrong.map(({ name, version }) => `${name} ${version}`).join(', ');
        throw new Error(`versi paket npm harus ${expected}${tag ? ` (tag ${tag})` : ''} — berbeda: ${list}`);
    }
    return expected;
}

/**
 * Langkah terbit sesuai urutan `manifests`; paket yang versinya sudah ada di registry ditandai `skip`.
 * @param {{ dir: string, name: string }[]} manifests
 * @param {(name: string) => boolean} isPublished
 */
export function planPublish(manifests, isPublished) {
    return manifests.map(({ dir, name }) => ({ dir, name, skip: isPublished(name) }));
}
