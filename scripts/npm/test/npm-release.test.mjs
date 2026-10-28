// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { NPM_PACKAGES, isAlreadyPublishedError, planPublish, releaseVersionOf, versionFromTag } from '../release.mjs';

const manifestsAt = (...versions) => versions.map((version, index) => ({
    dir: NPM_PACKAGES[index],
    name: `@plasgos/${NPM_PACKAGES[index]}`,
    version,
}));

describe('rilis npm', () => {
    it('paket inti terbit lebih dulu (wrapper bergantung padanya)', () => {
        expect(NPM_PACKAGES[0]).toBe('webchat');
        expect(NPM_PACKAGES).toHaveLength(5);
    });

    it('tag npm-vX.Y.Z → X.Y.Z; bentuk lain ditolak', () => {
        expect(versionFromTag('npm-v1.2.3')).toBe('1.2.3');
        expect(() => versionFromTag('v1.2.3')).toThrow('npm-vX.Y.Z');
        expect(() => versionFromTag('npm-v1.2')).toThrow('npm-vX.Y.Z');
        expect(() => versionFromTag('npm-v1.2.3-rc.1')).toThrow('npm-vX.Y.Z');
    });

    it('semua paket harus berversi sama dengan tag', () => {
        expect(releaseVersionOf(manifestsAt('1.0.0', '1.0.0', '1.0.0', '1.0.0', '1.0.0'), 'npm-v1.0.0')).toBe('1.0.0');
        expect(() => releaseVersionOf(manifestsAt('1.0.0', '1.0.0', '1.0.0', '1.0.0', '1.0.0'), 'npm-v1.0.1'))
            .toThrow('berbeda: @plasgos/webchat 1.0.0');
    });

    it('tanpa tag: versi paket inti jadi acuan, paket yang tertinggal disebut', () => {
        expect(releaseVersionOf(manifestsAt('1.1.0', '1.1.0', '1.1.0', '1.1.0', '1.1.0'))).toBe('1.1.0');
        expect(() => releaseVersionOf(manifestsAt('1.1.0', '1.1.0', '1.0.0', '1.1.0', '1.0.0')))
            .toThrow('berbeda: @plasgos/vue 1.0.0, @plasgos/svelte 1.0.0');
    });

    it('versi yang sudah terbit dilewati, urutan tetap (aman dijalankan ulang)', () => {
        const published = new Set(['@plasgos/webchat', '@plasgos/react']);
        const plan = planPublish(manifestsAt('1.0.0', '1.0.0', '1.0.0', '1.0.0', '1.0.0'), (name) => published.has(name));
        expect(plan.map(({ dir, skip }) => [dir, skip])).toEqual([
            ['webchat', true],
            ['react', true],
            ['vue', false],
            ['angular', false],
            ['svelte', false],
        ]);
    });

    it('penolakan "versi sudah ada" = sudah terbit; penolakan lain tetap galat', () => {
        expect(isAlreadyPublishedError('npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@plasgos%2fwebchat'
            + ' - You cannot publish over the previously published versions: 1.0.0.')).toBe(true);
        expect(isAlreadyPublishedError('npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@plasgos%2fwebchat'
            + ' - OIDC permission denied for this action')).toBe(false);
        expect(isAlreadyPublishedError('npm error code E404')).toBe(false);
    });
});
