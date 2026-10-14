// Pages Router: widget dipasang di _app dengan path dari router Next.
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { PlasgosWebchat } from '@plasgos/webchat-react';

export default function App({ Component, pageProps }: AppProps): React.JSX.Element {
    const router = useRouter();
    return (
        <>
            <Component {...pageProps} />
            <PlasgosWebchat
                widgetId="wgt_0123456789abcdef01234567"
                loaderUrl="http://localhost:4400/packages/loader/dist/loader.js"
                widgetOrigin="http://127.0.0.1:4400"
                load="eager"
                pathname={router.asPath}
            />
        </>
    );
}
