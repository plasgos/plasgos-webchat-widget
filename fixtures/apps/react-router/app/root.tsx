// Widget dipasang sekali di root dengan path dari router — navigasi <Link> dilaporkan dari sini.
import { PlasgosWebchat } from '@plasgos/webchat-react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from 'react-router';

export function Layout({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
    return (
        <html lang="id">
            <head>
                <meta charSet="utf-8" />
                <Meta />
                <Links />
            </head>
            <body>
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export default function App(): React.JSX.Element {
    const { pathname } = useLocation();
    return (
        <>
            <Outlet />
            <PlasgosWebchat
                widgetId="wgt_0123456789abcdef01234567"
                loaderUrl="http://localhost:4400/packages/loader/dist/loader.js"
                widgetOrigin="http://127.0.0.1:4400"
                load="eager"
                pathname={pathname}
            />
        </>
    );
}
