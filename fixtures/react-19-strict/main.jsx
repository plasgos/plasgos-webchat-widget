// Aplikasi React dalam StrictMode (efek dipasang dua kali) dengan @plasgos/webchat-react: tetap satu widget;
// tombol bantuan buatan tenant membuka chat lewat hook.
import { StrictMode, version } from 'react';
import { createRoot } from 'react-dom/client';
import { PlasgosWebchat, usePlasgosWebchat } from '@plasgos/webchat-react';

function HelpButton() {
    const webchat = usePlasgosWebchat();
    return <button id="bantuan" type="button" onClick={() => webchat.open()}>Butuh bantuan? ({webchat.state.unread})</button>;
}

function App() {
    return (
        <main>
            <h1 id="versi">React {version}</h1>
            <HelpButton />
            <PlasgosWebchat
                widgetId="wgt_0123456789abcdef01234567"
                loaderUrl="/packages/loader/dist/loader.js"
                widgetOrigin="http://127.0.0.1:4400"
                load="eager"
            />
        </main>
    );
}

createRoot(document.getElementById('app')).render(<StrictMode><App /></StrictMode>);
