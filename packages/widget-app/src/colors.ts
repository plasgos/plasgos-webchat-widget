const HEX = /^#([0-9a-f]{6})$/i;

function channel(value: number): number {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
    const value = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
}

export function contrastRatio(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

/** Warna utama tenant yang sah, atau bawaan Plasgos. */
export function safeColor(value: string | undefined): string {
    return value && HEX.test(value) ? value.toLowerCase() : '#f0592b';
}

/** Teks di atas warna utama: putih atau hampir-hitam, mana yang kontrasnya lebih tinggi (WCAG AA untuk teks tebal). */
export function textOn(background: string): string {
    return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#1b1b1f') ? '#ffffff' : '#1b1b1f';
}
