/**
 * Halaman chat penuh `/m/:widget_id` (WebView aplikasi mobile & tautan chat langsung).
 *
 * Identitas pelanggan TIDAK diambil dari URL (W10b): token di tautan (`#identity_token=…`) bisa dibuat penyerang —
 * korban yang membuka tautan itu diam-diam masuk sebagai akun penyerang dan semua yang ia ketik masuk ke kontak
 * penyerang (login CSRF). Aplikasi mobile memberikan token lewat JavaScript yang disuntikkan ke WebView —
 * `Plasgos("identify", { token })`, sama dengan di website; tautan tak bisa menyuntikkan JavaScript.
 * Fragmen `identity_token` yang masih datang dihapus dari alamat (tak tersimpan di riwayat & jejak halaman), diabaikan.
 */
import type { HostCommand } from '@plasgos/webchat-protocol';

const PARAM = 'identity_token';
const COMMANDS: ReadonlySet<HostCommand> = new Set<HostCommand>(['identify', 'shutdown', 'setLocale', 'track', 'consent']);

export interface StandaloneCommand {
    readonly name: HostCommand;
    readonly args: readonly unknown[];
}

/** URL halaman tanpa fragmen identitas; `true` bila fragmen itu ada (dan sudah dibuang). */
export function stripIdentityFragment(
    location: Pick<Location, 'href' | 'hash'>,
    replaceUrl: (url: string) => void,
): { readonly url: string; readonly stripped: boolean } {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!params.has(PARAM)) {
        return { url: location.href, stripped: false };
    }
    params.delete(PARAM);
    const rest = params.toString();
    const url = `${location.href.split('#')[0] ?? ''}${rest ? `#${rest}` : ''}`;
    replaceUrl(url);
    return { url, stripped: true };
}

/**
 * `window.Plasgos(name, ...args)` di halaman penuh — untuk JavaScript yang disuntikkan aplikasi mobile. Hanya perintah
 * sesi/identitas (bukan `boot`: halaman ini sudah menjadi widget).
 */
export function standaloneApi(run: (command: StandaloneCommand) => void): (name: unknown, ...args: unknown[]) => void {
    return (name, ...args) => {
        if (typeof name === 'string' && COMMANDS.has(name as HostCommand)) {
            run({ name: name as HostCommand, args });
        }
    };
}
