import { mergeApplicationConfig } from '@angular/core';
import type { ApplicationConfig } from '@angular/core';
import { provideServerRendering, RenderMode, withRoutes } from '@angular/ssr';

import { appConfig } from './app.config';

/** Semua rute dirender di server per permintaan (bukan prerender) — jalur SSR + hidrasi sungguhan. */
const serverConfig: ApplicationConfig = {
    providers: [provideServerRendering(withRoutes([{ path: '**', renderMode: RenderMode.Server }]))],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
