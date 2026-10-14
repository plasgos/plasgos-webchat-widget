// Konsumsi paket yang SUDAH DIBANGUN seperti pengguna npm di Node (SSR): ESM & CommonJS, kedua entri, tanpa galat
// dan tanpa efek — tak ada window/document di sini.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esm = await import('../dist/index.js');
const cjs = require('../dist/index.cjs');
await import('../dist/element.js');
require('../dist/element.cjs');

for (const [name, api] of [['esm', esm], ['cjs', cjs]]) {
    if (typeof api.loadWebchat !== 'function' || api.isBrowser() !== false) throw new Error(`${name}: ekspor tak lengkap`);
    const client = await api.loadWebchat({ widgetId: 'wgt_0123456789abcdef01234567' });
    client.open();
    if (client.getState().booted !== false) throw new Error(`${name}: getState di server harus kosong`);
}
console.info('smoke: ESM & CJS (index + element) dapat diimpor di Node tanpa galat');
