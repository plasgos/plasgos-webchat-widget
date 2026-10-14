/**
 * LOADER widget webchat — berjalan di halaman website tenant (CDN `loader/v1/loader.js`).
 *
 * W3a: kerangka build & anggaran ukuran. Isinya baru singleton global + pengambilalihan antrean snippet
 * `Plasgos(...)`; seluruh aturan WEBCHAT_EMBED_COMPATIBILITY.md §5 (SSR-safe, CSSOM, nonce, MutationObserver,
 * navigasi SPA, protokol postMessage, mode load) diisi di W3b.
 */
import { PROTOCOL_VERSION } from '@plasgos/webchat-protocol';

import { installGlobal } from './global';

installGlobal(window, PROTOCOL_VERSION);
