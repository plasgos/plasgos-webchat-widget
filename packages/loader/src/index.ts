/**
 * LOADER widget webchat — berjalan di halaman website tenant (CDN `loader/v1/loader.js`). Aturan yang dipenuhi:
 * WEBCHAT_EMBED_COMPATIBILITY.md §5 (singleton & idempoten, CSSOM tanpa inline style, tanpa eval/innerHTML,
 * MutationObserver, navigasi SPA, protokol postMessage v1, mode load idle/interaction/eager, batas waktu ready,
 * galat tak pernah dilempar). Loader tidak memanggil API apa pun — jaringan seluruhnya di dalam iframe.
 */
import { start } from './start';

start(window, document);
