import Link from 'next/link';

export default function Home(): React.JSX.Element {
    return (
        <main>
            <h1>Toko Next (App Router)</h1>
            <Link id="ke-produk" href="/produk">Lihat produk</Link>
        </main>
    );
}
