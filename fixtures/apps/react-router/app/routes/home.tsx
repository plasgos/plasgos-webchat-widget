import { Link } from 'react-router';

export function meta(): { title: string }[] {
    return [{ title: 'Toko React Router' }];
}

export default function Home(): React.JSX.Element {
    return (
        <main>
            <h1>Toko React Router</h1>
            <Link id="ke-produk" to="/produk">Lihat produk</Link>
        </main>
    );
}
