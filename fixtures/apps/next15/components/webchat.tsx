'use client';
// Komponen klien: dipasang dari layout Server Component (App Router).
import { usePathname } from 'next/navigation';
import { PlasgosWebchat } from '@plasgos/webchat-react';

export function Webchat(): React.JSX.Element {
    const pathname = usePathname();
    return (
        <PlasgosWebchat
            widgetId="wgt_0123456789abcdef01234567"
            loaderUrl="http://localhost:4400/packages/loader/dist/loader.js"
            widgetOrigin="http://127.0.0.1:4400"
            load="eager"
            pathname={pathname}
        />
    );
}
