/** Nama singleton global — satu per halaman, apa pun jumlah snippet/paket yang terpasang. */
export const GLOBAL_KEY = '__plasgosWebchat';

/** Nama fungsi antrean snippet (`Plasgos('boot', {...})`). */
export const COMMAND_KEY = 'Plasgos';

export type QueuedCall = readonly unknown[];

export interface WebchatGlobal {
    readonly protocolVersion: number;
    readonly pending: QueuedCall[];
}

interface QueueFunction {
    (...args: unknown[]): void;
    q?: QueuedCall[];
}

type HostWindow = Window & { [GLOBAL_KEY]?: WebchatGlobal; [COMMAND_KEY]?: QueueFunction };

/**
 * Pasang singleton sekali; pemanggilan berikutnya (snippet ganda, HMR) mengembalikan yang sudah ada.
 * Antrean snippet yang terkumpul sebelum loader siap dipindahkan ke singleton, lalu `Plasgos(...)` berikutnya
 * masuk langsung ke sana.
 */
export function installGlobal(host: Window, protocolVersion: number): WebchatGlobal {
    const target = host as HostWindow;
    const existing = target[GLOBAL_KEY];
    if (existing) {
        return existing;
    }

    const queued = target[COMMAND_KEY]?.q ?? [];
    const instance: WebchatGlobal = { protocolVersion, pending: [...queued] };
    target[GLOBAL_KEY] = instance;
    target[COMMAND_KEY] = (...args: unknown[]): void => {
        instance.pending.push(args);
    };

    return instance;
}
