import { describe, expect, it } from 'vitest';

import { parseBootOptions } from '../src/options';

const WIDGET_ID = 'wgt_0123456789abcdef01234567';

describe('opsi boot', () => {
    it('nilai bawaan: load idle, pelacakan halaman menyala, tanpa penimpaan tata letak', () => {
        const result = parseBootOptions({ widgetId: WIDGET_ID });

        expect(result).toEqual({
            ok: true,
            value: {
                widget: { widgetId: WIDGET_ID },
                loader: { load: 'idle', autoPageTracking: true, zIndex: null, position: null, offset: null },
            },
        });
    });


    it('opsi widget & loader yang sah diteruskan; nilai di luar batas diabaikan per kolom', () => {
        const result = parseBootOptions({
            widgetId: WIDGET_ID,
            locale: 'en',
            hideLauncher: true,
            load: 'interaction',
            autoPageTracking: false,
            zIndex: 99,
            position: 'left',
            offset: { x: 24, y: 9999 },
        });

        expect(result.ok && result.value.widget).toEqual({ widgetId: WIDGET_ID, locale: 'en', hideLauncher: true });
        expect(result.ok && result.value.loader).toEqual({ load: 'interaction', autoPageTracking: false, zIndex: 99, position: 'left', offset: null });
    });


    it('widgetId salah / bukan objek → ditolak dengan alasan, tidak melempar', () => {
        expect(parseBootOptions(null).ok).toBe(false);
        expect(parseBootOptions({ widgetId: 'wgt_01J...' }).ok).toBe(false);
        expect(parseBootOptions({ widgetId: 42 }).ok).toBe(false);
    });
});
