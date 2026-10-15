import type { FrameLayout } from '@plasgos/webchat-protocol';

import type { Appearance } from './types';

/** Lebar halaman (CSS px) di bawah ini → jendela chat layar penuh. */
export const MOBILE_BREAKPOINT = 640;
/** Launcher 56 px + ruang bayangan & badge. */
export const LAUNCHER_FRAME = 88;
export const WINDOW_WIDTH = 380;
/** Pesan proaktif di atas launcher (W8b): kartu ±300 px + launcher. */
export const TEASER_WIDTH = 320;
export const TEASER_HEIGHT = 200;
export const WINDOW_MAX_HEIGHT = 640;
const WINDOW_MARGIN = 100;

export interface Viewport {
    readonly width: number;
    readonly height: number;
}

/** Tata letak bingkai yang diminta ke loader untuk keadaan widget saat ini. */
export function frameLayout(
    open: boolean,
    appearance: Appearance,
    viewport: Viewport,
    hideLauncher: boolean,
    teaser = false,
): FrameLayout {
    const position = appearance.position === 'left' ? 'left' : 'right';
    const offsetX = appearance.offset?.x ?? 20;
    const offsetY = appearance.offset?.y ?? 20;
    const zIndex = appearance.z_index ?? null;
    const base = { position, offsetX, offsetY, zIndex } as const;

    if (!open) {
        if (hideLauncher) {
            return { ...base, state: 'hidden', width: 0, height: 0, fullscreen: false };
        }
        // Pesan proaktif tampil di atas launcher; di layar sempit lebarnya menyesuaikan (sisakan tepi 16 px).
        if (!teaser) {
            return { ...base, state: 'launcher', width: LAUNCHER_FRAME, height: LAUNCHER_FRAME, fullscreen: false };
        }
        const width = Math.min(TEASER_WIDTH, Math.max(LAUNCHER_FRAME, viewport.width - offsetX - 16));
        return { ...base, state: 'teaser', width, height: TEASER_HEIGHT, fullscreen: false };
    }

    const fullscreen = viewport.width < MOBILE_BREAKPOINT;
    const height = Math.max(360, Math.min(WINDOW_MAX_HEIGHT, viewport.height - WINDOW_MARGIN));
    return { ...base, state: 'open', width: fullscreen ? viewport.width : WINDOW_WIDTH, height: fullscreen ? viewport.height : height, fullscreen };
}
