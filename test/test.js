import chai, {expect} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {isNil} from 'lodash-es';
import testServer from './server.js';
import {duelFetch, DuelFetch} from '#src/fetch';

chai.use(chaiAsPromised);

const context = {};

before(async () => {
    context.server = await testServer;
    context.testRequestURL = input => `${context.server.origin}/request?${new URLSearchParams(input)}`;
});

after(() => context.server.close());

describe('duelFetch()', () => {

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
                    failMessage: 'Failed with status 500 after 2 attempts',
                },
            ],
        ];

        for (const [input, expected] of samples) {

            const url = context.testRequestURL(input);

            const response = await
                duelFetch(url);

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

            // Extensions.
            expect(response.stats.runs.length - 1)
                .to.equal(expected.retrys?.count || 0);

            if (! isNil(expected.retrys?.fail)) {
                expect(response.stats.lastRun.failed)
                    .to.equal(expected.retrys.fail);
            }

            if (expected.failMessage) {
                expect(response.stats.failMessage)
                    .to.equal(expected.failMessage);
            }
        }
    });

    it('should retry requests with extension.timeout', async () => {

        let stats;
        const timeout = 100;
        const url = context.testRequestURL({delay: timeout * 2});

        const request = () => duelFetch(url, {
            extensions: {
                timeout,
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
            .to.equal(3);
        expect(stats.failMessage)
            .to.equal('Failed with AbortError after 3 attempts');
    });

    it('should handle broken request inputs as native fetch except for extension behaviour', async () => {

        let stats;

        await expect(duelFetch('https://localhost-must-not-exist.com', {
                extensions: {
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
        expect(stats.failMessage)
            .to.equal('Failed with Error (ENOTFOUND) after 4 attempts');
    });
});

describe('DuelFetch.bodyData()', () => {

    it('should resolve resolve body data', async () => {

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

            const response = await
                duelFetch(context.testRequestURL(input));

            expect(await DuelFetch.bodyData(response))
                .to.equal(expected);
        }
    });
});
