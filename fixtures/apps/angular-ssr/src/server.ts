import { join } from 'node:path';

import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';

const browserDistFolder = join(import.meta.dirname, '../browser');
const app = express();
const angularApp = new AngularNodeAppEngine({ allowedHosts: ['localhost'] });

app.use(express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false }));

app.use((req, res, next) => {
    angularApp
        .handle(req)
        .then(async (response) => {
            if (response) {
                await writeResponseToNodeResponse(response, res);
            } else {
                next();
            }
        })
        .catch(next);
});

if (isMainModule(import.meta.url)) {
    const port = process.env['PORT'] ?? 4000;
    app.listen(port, () => {
        console.info(`Angular SSR di http://localhost:${String(port)}`);
    });
}

export const reqHandler = createNodeRequestHandler(app);
