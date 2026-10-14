// Gaya & mutu kode repo widget: TypeScript strict tanpa `any`, 4 spasi, kutip tunggal, titik koma, ≤120 kolom.
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const style = {
    '@stylistic/indent': ['error', 4, { SwitchCase: 1 }],
    '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
    '@stylistic/semi': ['error', 'always'],
    '@stylistic/comma-dangle': ['error', 'always-multiline'],
    '@stylistic/no-trailing-spaces': 'error',
    '@stylistic/eol-last': ['error', 'always'],
    '@stylistic/max-len': ['error', { code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
    'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
};

export default tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'test-results/**', 'playwright-report/**', '.lighthouse/**'] },
    {
        files: ['**/*.{js,mjs}'],
        extends: [js.configs.recommended],
        plugins: { '@stylistic': stylistic },
        languageOptions: { globals: { ...globals.node } },
        rules: style,
    },
    {
        files: ['**/*.{ts,tsx}'],
        extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
        plugins: { '@stylistic': stylistic },
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
            globals: { ...globals.browser },
        },
        rules: {
            ...style,
            '@typescript-eslint/no-explicit-any': 'error',
            // Komponen Angular tanpa logika = kelas kosong ber-decorator (pola baku Angular).
            '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
            '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        },
    },
    {
        // Fixture = website tenant & stub iframe uji: JavaScript peramban apa adanya (ES5, tanpa bundler).
        files: ['fixtures/**/*.js'],
        languageOptions: { globals: { ...globals.browser }, sourceType: 'script' },
        rules: { '@stylistic/max-len': 'off' },
    },
    {
        // Aplikasi fixture framework (Solid, Lit, npm) = modul ES yang dibundel scripts/build-fixtures.mjs.
        files: ['fixtures/*/main.{js,jsx}'],
        languageOptions: { sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    },
    {
        files: ['**/test/**/*.{ts,tsx}', 'e2e/**/*.ts', 'e2e-live/**/*.ts'],
        rules: { '@typescript-eslint/explicit-function-return-type': 'off' },
    },
);
