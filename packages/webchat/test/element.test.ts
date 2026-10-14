import { describe, expect, it } from 'vitest';

describe('<plasgos-webchat>', () => {
    it('terdaftar sekali; atribut → boot, identity-token diganti → identify, dihapus → shutdown', async () => {
        await import('../src/element');
        await import('../src/element');
        expect(customElements.get('plasgos-webchat')).toBeDefined();

        const element = document.createElement('plasgos-webchat');
        element.setAttribute('widget-id', 'wgt_0123456789abcdef01234567');
        element.setAttribute('loader-url', '/loader.js');
        element.setAttribute('identity-token', 'jwt-1');
        document.body.appendChild(element);
        element.setAttribute('identity-token', 'jwt-2');
        element.removeAttribute('identity-token');

        const queue = (window as unknown as { Plasgos: { q: unknown[][] } }).Plasgos.q;
        expect(queue).toEqual([
            ['boot', { widgetId: 'wgt_0123456789abcdef01234567' }],
            ['identify', { token: 'jwt-1' }],
            ['identify', { token: 'jwt-2' }],
            ['shutdown'],
        ]);
        expect(element.style.display).toBe('none');
    });
});

describe('<plasgos-webchat> lewat properti (Solid, React 19)', () => {
    it('properti identityToken dicerminkan ke atribut → identify / shutdown', async () => {
        await import('../src/element');
        const queue = (window as unknown as { Plasgos: { q: unknown[][] } }).Plasgos.q;
        queue.length = 0;
        const element = document.createElement('plasgos-webchat') as HTMLElement & { identityToken: string | null; widgetId: string | null };
        element.widgetId = 'wgt_0123456789abcdef01234567';
        document.body.appendChild(element);

        element.identityToken = 'jwt-solid';
        expect(element.getAttribute('identity-token')).toBe('jwt-solid');
        element.identityToken = null;

        expect(queue.slice(-2)).toEqual([['identify', { token: 'jwt-solid' }], ['shutdown']]);
    });
});
