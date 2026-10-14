import { describe, expect, it } from 'vitest';

import {
    createMessage,
    isFromPeer,
    isHostCommand,
    parseHostMessage,
    parseWidgetMessage,
    PROTOCOL_VERSION,
} from '../src/index';

describe('protokol postMessage v1', () => {
    it('membentuk pesan { v, type, payload }', () => {
        const message = createMessage('widget.ready', {});

        expect(message).toEqual({ v: PROTOCOL_VERSION, type: 'widget.ready', payload: {} });
    });


    it('loader hanya mengenali pesan widget; iframe hanya mengenali pesan host', () => {
        const fromWidget = createMessage('widget.ready', {});
        const fromHost = createMessage('host.command', { name: 'open', args: [] });

        expect(parseWidgetMessage(fromWidget)).toEqual(fromWidget);
        expect(parseWidgetMessage(fromHost)).toBeNull();
        expect(parseHostMessage(fromHost)).toEqual(fromHost);
        expect(parseHostMessage(fromWidget)).toBeNull();
    });


    it('versi lain, tipe tak dikenal, dan bentuk rusak diabaikan (null), tidak melempar', () => {
        const samples: unknown[] = [
            null,
            'widget.ready',
            { v: 2, type: 'widget.ready', payload: {} },
            { v: 1, type: 'widget.unknown', payload: {} },
            { v: 1, type: 'widget.ready' },
            { v: 1, type: 'widget.ready', payload: [] },
        ];

        for (const sample of samples) {
            expect(parseWidgetMessage(sample)).toBeNull();
        }
    });


    it('event dipercaya hanya bila origin DAN source cocok', () => {
        const frame = {};
        const peer = { origin: 'https://widget.plasgoschat.com', source: frame };

        expect(isFromPeer({ origin: 'https://widget.plasgoschat.com', source: frame as Window }, peer)).toBe(true);
        expect(isFromPeer({ origin: 'https://widget.plasgoschat.com', source: {} as Window }, peer)).toBe(false);
        expect(isFromPeer({ origin: 'https://evil.example', source: frame as Window }, peer)).toBe(false);
    });


    it('perintah host dikenali dari daftar tertutup', () => {
        expect(isHostCommand('open')).toBe(true);
        expect(isHostCommand('eval')).toBe(false);
        expect(isHostCommand(1)).toBe(false);
    });
});
