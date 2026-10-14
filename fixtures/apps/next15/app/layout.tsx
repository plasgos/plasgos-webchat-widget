import { Webchat } from '../components/webchat';

export const metadata = { title: 'Toko Next' };

export default function RootLayout({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
    return (
        <html lang="id">
            <body>
                {children}
                <Webchat />
            </body>
        </html>
    );
}
