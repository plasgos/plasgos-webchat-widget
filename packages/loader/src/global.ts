/** Nama singleton global — satu per halaman, apa pun jumlah snippet/paket yang terpasang. */
export const GLOBAL_KEY = '__plasgosWebchat';

/** Nama fungsi perintah publik (`Plasgos('boot', {...})`). */
export const COMMAND_KEY = 'Plasgos';

export type CommandHandler = (name: unknown, args: readonly unknown[]) => unknown;

export interface WebchatGlobal {
    readonly protocolVersion: number;
    readonly call: (name: unknown, ...args: unknown[]) => unknown;
}

interface QueueFunction {
    (...args: unknown[]): unknown;
    q?: ArrayLike<unknown>[];
}

type HostWindow = Window & { [GLOBAL_KEY]?: WebchatGlobal; [COMMAND_KEY]?: QueueFunction };

export interface InstallResult {
    readonly instance: WebchatGlobal;
    /** false = loader lain sudah terpasang di halaman ini (snippet ganda, plugin + snippet) — jangan apa-apa. */
    readonly created: boolean;
}

/**
 * Pasang singleton sekali. Antrean snippet yang terkumpul sebelum loader siap diputar ulang BERURUTAN ke
 * `handler`; setelah itu `Plasgos(...)` langsung memanggil `handler` dan mengembalikan nilainya (mis. `getState`).
 */
export function installGlobal(host: Window, protocolVersion: number, handler: CommandHandler): InstallResult {
    const target = host as HostWindow;
    const existing = target[GLOBAL_KEY];
    // `typeof … call` — elemen ber-id `__plasgosWebchat` di halaman (DOM clobbering) bukan loader terpasang.
    if (typeof existing?.call === 'function') {
        return { instance: existing, created: false };
    }

    const queued = Array.from(target[COMMAND_KEY]?.q ?? []);
    const instance: WebchatGlobal = {
        protocolVersion,
        call: (name: unknown, ...args: unknown[]): unknown => handler(name, args),
    };
    target[GLOBAL_KEY] = instance;
    target[COMMAND_KEY] = (...args: unknown[]): unknown => instance.call(args[0], ...args.slice(1));
    for (const call of queued) {
        const args = Array.from(call);
        handler(args[0], args.slice(1));
    }

    return { instance, created: true };
}
