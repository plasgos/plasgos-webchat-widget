import { describe, expect, it } from 'vitest';

import { PublicApi } from '../src/api';
import { PageTracker, trackPropertiesOf } from '../src/tracking';
import type { TrackingEvent } from '../src/tracking';

/** Penjadwal manual: debounce dijalankan saat uji memanggil `run()`. */
interface ManualClock {
    schedule: (cb: () => void) => unknown;
    cancel: (h: unknown) => void;
    run: () => Promise<void>;
}

function manualClock(): ManualClock {
    let pending: (() => void) | null = null;
    return {
        schedule: (cb) => {
            pending = cb;
            return 1;
        },
        cancel: () => {
            pending = null;
        },
        run: async () => {
            const cb = pending;
            pending = null;
            cb?.();
            await Promise.resolve();
            await Promise.resolve();
        },
    };
}

function tracker(consentRequired = false): { tracker: PageTracker; sent: TrackingEvent[][]; clock: ManualClock } {
    const sent: TrackingEvent[][] = [];
    const clock = manualClock();
    const instance = new PageTracker({
        send: (events) => {
            sent.push([...events]);
            return Promise.resolve();
        },
        schedule: clock.schedule,
        cancel: clock.cancel,
    }, consentRequired);
    return { tracker: instance, sent, clock };
}

describe('jejak halaman & event (W8a)', () => {
    it('navigasi beruntun dikirim sebagai satu batch; URL sama berturut-turut diabaikan', async () => {
        const { tracker: t, sent, clock } = tracker();
        t.setReady(true);
        t.pageView({ url: 'https://toko.test/', title: 'Beranda' });
        t.pageView({ url: 'https://toko.test/', title: 'Beranda' });
        t.pageView({ url: 'https://toko.test/harga', title: 'Harga' });
        t.track('add_to_cart', { sku: 'K-1', qty: 2 });
        await clock.run();

        expect(sent).toHaveLength(1);
        expect(sent[0]?.map((e) => e.type)).toEqual(['page_view', 'page_view', 'track']);
    });


    it('batch maks. 20 event per kiriman', async () => {
        const { tracker: t, sent, clock } = tracker();
        t.setReady(true);
        for (let i = 0; i < 45; i += 1) {
            t.track('scroll', { i });
        }
        await clock.run();

        expect(sent.map((b) => b.length)).toEqual([20, 20, 5]);
    });


    it('consentRequired: ditahan sampai disetujui; ditolak = antrean dibuang & tak ada kiriman lagi', async () => {
        const granted = tracker(true);
        granted.tracker.setReady(true);
        granted.tracker.pageView({ url: 'https://toko.test/a' });
        await granted.clock.run();
        expect(granted.sent).toHaveLength(0);
        granted.tracker.setConsent(true);
        await granted.clock.run();
        expect(granted.sent.flat()).toHaveLength(1);

        const denied = tracker(true);
        denied.tracker.setReady(true);
        denied.tracker.pageView({ url: 'https://toko.test/a' });
        denied.tracker.setConsent(false);
        denied.tracker.pageView({ url: 'https://toko.test/b' });
        await denied.clock.run();
        expect(denied.sent).toHaveLength(0);
        expect(denied.tracker.pending).toHaveLength(0);
    });


    it('tenant mematikan pelacakan halaman → tak ada kiriman; belum ada sesi → ditahan', async () => {
        const off = tracker();
        off.tracker.setEnabled(false);
        off.tracker.setReady(true);
        off.tracker.pageView({ url: 'https://toko.test/a' });
        await off.clock.run();
        expect(off.sent).toHaveLength(0);

        const early = tracker();
        early.tracker.pageView({ url: 'https://toko.test/a' });
        await early.clock.run();
        expect(early.sent).toHaveLength(0);
        early.tracker.setReady(true);
        await early.clock.run();
        expect(early.sent.flat()).toHaveLength(1);
    });


    it('nama/properti track yang tak diterima server dibuang di widget', () => {
        const { tracker: t } = tracker();
        expect(t.track('beli sekarang!')).toBe(false);
        expect(t.track('beli', { nested: { a: 1 } })).toBe(false);
        expect(t.track('beli', [1, 2])).toBe(false);
        expect(trackPropertiesOf({ note: 'x'.repeat(500) })?.['note']).toHaveLength(200);
        expect(trackPropertiesOf(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${String(i)}`, i])))).toBeNull();
    });


    it('klien API: POST /events dengan keepalive saat halaman ditutup', async () => {
        const seen: RequestInit[] = [];
        const api = new PublicApi('https://widget.test', (_url, init) => {
            if (init) {
                seen.push(init);
            }
            const data = { accepted: 1, stored: 1, dropped: 0, tracking: true };
            return Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 202 }));
        });

        const events = [{ type: 'page_view' as const, url: 'https://toko.test/' }];
        await expect(api.events('tok', events, { keepalive: true })).resolves.toMatchObject({ stored: 1 });
        expect(seen[0]?.keepalive).toBe(true);
        expect(JSON.parse(seen[0]?.body as string)).toEqual({ events });
    });


    it('jendela dibuka (W8c): sekali per sesi, tetap terkirim walau jejak halaman dimatikan, patuh persetujuan', async () => {
        const off = tracker();
        off.tracker.setEnabled(false);
        off.tracker.setReady(true);
        off.tracker.widgetOpened();
        off.tracker.widgetOpened();
        off.tracker.pageView({ url: 'https://toko.test/a' });
        await off.clock.run();
        expect(off.sent).toEqual([[{ type: 'widget_open' }]]);

        const denied = tracker(true);
        denied.tracker.setReady(true);
        denied.tracker.setConsent(false);
        denied.tracker.widgetOpened();
        await denied.clock.run();
        expect(denied.sent).toHaveLength(0);
    });
});
