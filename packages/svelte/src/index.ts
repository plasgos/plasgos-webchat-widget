/**
 * `@plasgos/webchat-svelte` — komponen `<PlasgosWebchat>` + store keadaan widget untuk Svelte 5 / SvelteKit.
 *
 *   import { PlasgosWebchat, webchat, webchatState } from '@plasgos/webchat-svelte';
 *   <button onclick={() => webchat.open()}>Bantuan ({$webchatState.unread})</button>
 */
import { readable } from 'svelte/store';
import type { Readable } from 'svelte/store';

import { getWebchat, isBrowser } from '@plasgos/webchat';
import type { WebchatClient, WebchatState } from '@plasgos/webchat';

export { default as PlasgosWebchat } from './PlasgosWebchat.svelte';
export type { WebchatClient, WebchatOptions, WebchatState } from '@plasgos/webchat';

const EMPTY_STATE: WebchatState = { booted: false, open: false, unread: 0, trustLevel: null };
const STATE_EVENTS = ['ready', 'open', 'close', 'unread_changed', 'error'] as const;

/** Klien widget di halaman ini (aman dipanggil di server: no-op). */
export const webchat: WebchatClient = getWebchat();

/** Keadaan widget (terbuka, belum dibaca, …) sebagai store Svelte; di server tetap kosong. */
export const webchatState: Readable<WebchatState> = readable<WebchatState>(EMPTY_STATE, (set) => {
    if (!isBrowser()) {
        return undefined;
    }
    const update = (): void => {
        set({ ...webchat.getState() });
    };
    const stops = STATE_EVENTS.map((event) => webchat.on(event, update));
    update();
    return () => {
        for (const stop of stops) {
            stop();
        }
    };
});
