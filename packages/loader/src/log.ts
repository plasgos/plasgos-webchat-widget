const PREFIX = '[Plasgos Webchat]';

/** Galat widget TIDAK PERNAH dilempar ke halaman tenant — hanya dicatat dengan awalan yang mudah dicari. */
export function warn(message: string, detail?: unknown): void {
    try {
        if (detail === undefined) {
            console.warn(`${PREFIX} ${message}`);
        } else {
            console.warn(`${PREFIX} ${message}`, detail);
        }
    } catch {
        // console bisa diganti/dimatikan website tenant — tetap tak boleh melempar.
    }
}
