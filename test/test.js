import agentKeepAlive from 'agentkeepalive';
import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {isNil} from 'lodash-es';
import {fetchEx, Response} from '../index.js';
import testServer from './server.js';

chai.use(chaiAsPromised);

const context = {};

before(async () => {
    context.server = await testServer;
    context.testRequestURL = input => `${context.server.origin}/request?${new URLSearchParams(input)}`;
});

after(() => context.server.close());

describe('fetchEx()', () => {

    it('should handle different request inputs as native fetch except for extension behaviour', async () => {

        const samples = [
            [
                {
                    text: 'Text',
                }, {
                    text: 'Text',
                    status: 200,
                },
            ],
            [
                {
                    json: '{"error":"not found"}',
                    status: 404,
                }, {
                    json: {error: 'not found'},
                    status: 404,
                },
            ],
            [
                {
                    json: '{"error":"internal"}',
                    status: 500,
                }, {
                    json: {error: 'internal'},
                    status: 500,
                    retrys: {
                        count: 1,
                        fail: true,
                    },
                    failMessage: 'failed with status 500 after 2 attempts',
                },
            ],
        ];

        for (const [input, expected] of samples) {

            const url = context.testRequestURL(input);

            const response = await
                fetchEx(url);

            expect(response)
                .to.be.instanceOf(Response);
            expect(response.status)
                .to.equal(expected.status);
            expect(response.url)
                .to.equal(url);

            if (expected.text) {
                expect(await response.text())
                    .to.equal(expected.text);
            }
            else if (expected.json) {
                expect(await response.json())
                    .to.eql(expected.json);
            }

            // Extension.
            const {stats} = response.extension;

            expect(stats.runs.length - 1)
                .to.equal(expected.retrys?.count || 0);

            if (! isNil(expected.retrys?.fail)) {
                expect(stats.lastRun.failed)
                    .to.equal(expected.retrys.fail);
            }

            if (expected.failMessage) {
                expect(stats.fail)
                    .to.include(expected.failMessage);
            }
        }
    });

    it('should retry requests with extension.timeout', async () => {

        let stats;
        const timeout = 100;
        const url = context.testRequestURL({
            delay: timeout * 2,
        });

        const request = () => fetchEx(url, {
            extension: {
                timeout,
                retry: {
                    limit: 2,
                    delay: 0,
                },
                onComplete(runStats) {
                    stats = runStats;
                },
                log: {
                    // eslint-disable-next-line no-console
                    fail: console.error,
                },
            },
        });

        await expect(request())
            .to.be.rejected;

        expect(stats.runs.length)
            .to.equal(3);
        expect(stats.fail)
            .to.include('failed with AbortError (Timeout <100 ms>) after 3 attempts');
    });

    it('should have retry behaviour nullified by user-specified abort controller', async () => {

        let stats;
        const timeout = 100;
        const url = context.testRequestURL({
            delay: timeout * 2,
        });

        const controller = new AbortController();

        setTimeout(() => {
            controller.abort('User-specified');
        }, timeout);

        const request = () => fetchEx(url, {
            signal: controller.signal,
            extension: {
                retry: {
                    limit: 2,
                    delay: 0,
                },
                onComplete(runStats) {
                    stats = runStats;
                },
            },
        });

        await expect(request())
            .to.be.rejected;

        expect(stats.runs.length)
            .to.equal(1);
        expect(stats.fail)
            .to.include('failed with AbortError (User-specified) after 1 attempt');
    });

    it('should handle broken request inputs as native fetch except for extension behaviour', async () => {

        let stats;

        await expect(fetchEx('https://localhost-must-not-exist.com', {
                extension: {
                    retry: {
                        limit: 3,
                        delay: 0,
                    },
                    onComplete(runStats) {
                        stats = runStats;
                    },
                },
            }))
            .to.be.rejected;

        expect(stats.runs.length)
            .to.equal(4);
        expect(stats.fail)
            .to.include('failed with FetchError (ENOTFOUND) after 4 attempts');
    });

    it('should accept a custom agent as supported by node-fetch', async () => {

        const agents = {
            http: new agentKeepAlive(),
            https: new agentKeepAlive
                .HttpsAgent(),
        };

        const agentResolver = url => (url.protocol === 'https:')
            ? agents.https
            : agents.http;

        const url = context
            .testRequestURL();

        const fetches = Array(5)
            .fill()
            .map(() => fetchEx(url, {
                extension: {
                    agent: agentResolver,
                    log: {
                        // eslint-disable-next-line no-console
                        ok: console.log,
                    },
                },
            }));

        await Promise.all(fetches);

        expect(agents.http.getCurrentStatus())
            .to.eql({
                closeSocketCount: 0,
                createSocketCount: 5,
                createSocketErrorCount: 0,
                errorSocketCount: 0,
                freeSockets: {'localhost:8080:': 5},
                requestCount: 5,
                requests: {},
                sockets: {},
                timeoutSocketCount: 0,
            });
    });
});

describe('response.extension.body()', () => {

    it('should infer and execute body parser', async () => {

        const samples = [
            [
                {json: 'true'},
                true,
            ],
            [
                {text: 'text'},
                'text',
            ],
        ];

        for (const [input, expected] of samples) {

            const url = context.testRequestURL(input);

            const response = await
                fetchEx(url);

            expect(await response.extension.body())
                .to.equal(expected);
        }
    });
});
