/**
 * Halaman chat penuh `/m/:widget_id` (WebView aplikasi mobile & tautan chat langsung): aplikasi yang punya login
 * mengirim token identitas lewat FRAGMEN URL (`#identity_token=<jwt>`) — fragmen tak pernah dikirim ke server, tak
 * masuk log akses/Referer. Token dibaca SEKALI lalu fragmennya dihapus dari alamat (riwayat & jejak halaman bersih).
 */
const PARAM = 'identity_token';

export interface StandalonePage {
    readonly identityToken: string | null;
    /** URL halaman tanpa fragmen identitas — dipakai untuk sesi & jejak halaman. */
    readonly url: string;
}

export function takeStandaloneIdentity(
    location: Pick<Location, 'href' | 'hash'>,
    replaceUrl: (url: string) => void,
): StandalonePage {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const token = params.get(PARAM);
    if (token === null) {
        return { identityToken: null, url: location.href };
    }
    params.delete(PARAM);
    const rest = params.toString();
    const url = `${location.href.split('#')[0] ?? ''}${rest ? `#${rest}` : ''}`;
    replaceUrl(url);
    return { identityToken: token.length > 0 && token.length <= 8192 ? token : null, url };
}
