/**
 * Aplikasi meta-framework matriks §7 (WEBCHAT_EMBED_COMPATIBILITY.md) — masing-masing di `fixtures/apps/<nama>`,
 * dibangun produksi dengan perangkatnya sendiri dan dijalankan di port tetap.
 */
export interface AppEntry {
    /** Halaman awal & tautan navigasi klien di dalamnya. */
    readonly path: string;
    readonly link: string;
    readonly target: string;
    readonly label: string;
}

export interface FixtureApp {
    readonly name: string;
    readonly port: number;
    readonly start: string;
    readonly entries: readonly AppEntry[];
}

export const APPS: readonly FixtureApp[] = [
    {
        name: 'next15',
        port: 4511,
        start: 'pnpm --dir fixtures/apps/next15 start',
        entries: [
            { label: 'App Router', path: '/', link: '#ke-produk', target: '/produk' },
            { label: 'Pages Router', path: '/lama', link: '#ke-lama-produk', target: '/lama-produk' },
        ],
    },
];

/** `APPS=next15,nuxt3` membatasi aplikasi yang diuji (yang belum dibangun dilewati). */
export function selectedApps(): readonly FixtureApp[] {
    const filter = (process.env['APPS'] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    return filter.length ? APPS.filter((app) => filter.includes(app.name)) : APPS;
}
