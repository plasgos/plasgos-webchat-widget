import Link from 'next/link';

export default function Legacy(): React.JSX.Element {
    return (
        <main>
            <h1>Toko Next (Pages Router)</h1>
            <Link id="ke-lama-produk" href="/lama-produk">Lihat produk lama</Link>
        </main>
    );
}
