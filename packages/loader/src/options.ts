import { WIDGET_ID_PATTERN } from '@plasgos/webchat-protocol';
import type { BootOptions, Position } from '@plasgos/webchat-protocol';

export const LOAD_MODES = ['idle', 'interaction', 'eager'] as const;

export type LoadMode = (typeof LOAD_MODES)[number];

export const DEFAULT_Z_INDEX = 2147483000;

/** Opsi `boot` yang dipakai loader sendiri (penempatan & cara memuat); sisanya diteruskan ke iframe. */
export interface LoaderOptions {
    readonly load: LoadMode;
    readonly autoPageTracking: boolean;
    readonly zIndex: number | null;
    readonly position: Position | null;
    readonly offset: { readonly x: number; readonly y: number } | null;
}

export interface ParsedBoot {
    readonly widget: BootOptions;
    readonly loader: LoaderOptions;
}

export type ParseResult =
    | { readonly ok: true; readonly value: ParsedBoot }
    | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function offsetOf(value: unknown): LoaderOptions['offset'] {
    if (!isRecord(value)) {
        return null;
    }

    const x = boundedInteger(value['x'], 0, 400);
    const y = boundedInteger(value['y'], 0, 400);
    return x === null || y === null ? null : { x, y };
}

/**
 * `identityToken` di opsi `boot` (halaman server-rendered untuk pelanggan yang login): boot + identify dalam satu
 * panggilan. Bukan opsi widget — diteruskan sebagai perintah `identify`.
 */
export function identityTokenOf(input: unknown): string | null {
    if (!isRecord(input)) {
        return null;
    }
    const token = input['identityToken'];
    return typeof token === 'string' && token.length > 0 && token.length <= 8192 ? token : null;
}

/**
 * Opsi `Plasgos('boot', {...})` dari tenant → opsi widget + opsi loader. Tak pernah melempar: masukan yang salah
 * jadi `{ ok: false, reason }` (dicatat sebagai peringatan, widget tidak menyala) atau diabaikan per kolom.
 */
export function parseBootOptions(input: unknown): ParseResult {
    if (!isRecord(input)) {
        return { ok: false, reason: 'boot membutuhkan objek opsi, mis. { widgetId: "wgt_…" }' };
    }

    const widgetId = input['widgetId'];
    if (typeof widgetId !== 'string' || !WIDGET_ID_PATTERN.test(widgetId)) {
        return { ok: false, reason: 'widgetId tidak valid (format wgt_ + 24 karakter heksa)' };
    }

    const locale = input['locale'] === 'en' || input['locale'] === 'id' ? input['locale'] : null;
    const load = (LOAD_MODES as readonly unknown[]).includes(input['load']) ? (input['load'] as LoadMode) : 'idle';
    const position = input['position'] === 'left' || input['position'] === 'right' ? input['position'] : null;

    return {
        ok: true,
        value: {
            widget: {
                widgetId,
                ...(locale ? { locale } : {}),
                ...(input['hideLauncher'] === true ? { hideLauncher: true } : {}),
                ...(input['consentRequired'] === true ? { consentRequired: true } : {}),
            },
            loader: {
                load,
                autoPageTracking: input['autoPageTracking'] !== false,
                zIndex: boundedInteger(input['zIndex'], 1, 2147483647),
                position,
                offset: offsetOf(input['offset']),
            },
        },
    };
}
