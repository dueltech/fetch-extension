import express from 'express';
import * as mimeTypes from '#src/mimeTypes';
import {sleep} from '#src/util';

const port = process.env.PORT || 8080;

const app = express();

// eslint-disable-next-line no-console
const log = msg => console.log(`[test-server] ${msg}`);

app.use((req, res, next) => {

    const start = Date.now();

    res.on('close', () => {
        const time = Date.now() - start;
        log(`${req.method} ${res.statusCode} ${req.originalUrl} ${time} ms`);
    });

    next();
});

app.get('/request', async (req, res) => {

    const {status=200, text, json, delay} = req.query;

    if (delay) {
        await sleep(delay);
    }

    if (json) {
        res.set('content-type', mimeTypes.json);
    }

    res.status(parseInt(status, 10));
    res.send(text || json);
});

export default new Promise((resolve, reject) => {

    const origin = `http://localhost:${port}`;

    const server = app.listen(port, error => {
        if (error) {
            reject(error);
        }
        else {
            log(`Up on ${origin}`);
            resolve({
                close: () => {
                    log('Closing...');
                    return server.close();
                },
                origin,
            });
        }
    });
});
