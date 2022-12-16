import {defaults, isEmpty, sum} from 'lodash-es';
import {isServerErrorCode} from '#src/httpCodes';
import * as httpMethods from '#src/httpMethods';
import * as mimeTypes from '#src/mimeTypes';
import {fetch, Request} from '#src/native';
import {assign, countOf, defineProperties, ms, sleep} from '#src/util';

export async function duelFetch(url, options) {

    const extension = options?.extension;

    if (extension) {
        delete options.extension;
    }

    const request = new DuelFetch([url, options], extension);

    return request.fetch();
}

class DuelFetch {

    constructor(fetchArgs, extension={}) {

        const defaultExtension = {
            retry: {
                limit: 1,
                delay: '100 ms',
                methods: [
                    httpMethods.DELETE,
                    httpMethods.GET,
                    httpMethods.HEAD,
                    httpMethods.PATCH,
                    httpMethods.PUT,
                ],
            },
        };

        defaults(extension, defaultExtension);

        for (const [k, v] of Object.entries(extension)) {
            defaults(v, defaultExtension[k]);
        }

        if (extension.timeout) {
            extension.timeout = ms(extension.timeout);
            if (fetchArgs.signal) {
                throw new TypeError('extension.timeout cannot be used with options.signal');
            }
        }

        assign(this, {
            extension,
            fetchArgs,
        });
    }

    async fetch() {

        const {extension} = this;
        const retryConfig = extension.retry;
        const runLimit = (retryConfig?.limit || 0) + 1;
        const runs = [];

        let run;

        do {
            if (run?.retryable) {
                await sleep(retryConfig.delay);
            }

            const startTime = Date.now();
            run = {};

            try {
                const [fetchURL] = this.fetchArgs;
                const fetchOpts = {
                    ...this.fetchArgs[1],
                    ...(extension.timeout && {
                        signal: AbortSignal.timeout(extension.timeout),
                    }),
                    ...(extension.agent && {
                        agent: extension.agent,
                    }),
                };

                this.request = new Request(fetchURL, fetchOpts);
                this.response = await fetch(this.request);

                await this.#evaluate(run);
            }
            catch (error) {
                await this.#evaluate(run, error);
            }

            runs.push(defineProperties(run, {
                time: {
                    enumerable: true,
                    value: Date.now() - startTime,
                },
                failed: {
                    get() {
                        return Boolean(this.error || this.retryable);
                    },
                },
            }));
        }
        while (run.retryable && runs.length < runLimit);

        this.extension?.onComplete?.(this.#stats(runs));

        if (run.error) {
            throw run.error;
        }

        return this.#augmentResponse(runs);
    }

    #augmentResponse(runs) {

        return defineProperties(this.response, {
            extension: {
                value: {
                    stats: this.#stats(runs),
                    /*
                     * Infer body parser based on content-type.
                     */
                    body: async () => {

                        const type = this.response.headers
                            .get('content-type') || '';

                        return type.includes(mimeTypes.json)
                            ? this.response.json()
                            : this.response.text();
                    },
                },
            },
        });
    }

    #stats(runs) {

        const stats = {
            runs,
        };

        const timings = runs
            .map(it => it.time);

        stats.totalFetchTime = sum(timings);
        stats.maxFetchTime = Math.max(...timings);
        stats.lastRun = runs.at(-1);

        if (stats.lastRun.failed) {
            const {error} = stats.lastRun;
            stats.failMessage = (error
                ? `Failed with ${DuelFetch.#errorSummary(error)}`
                : `Failed with status ${stats.lastRun.status}`)
                + ` after ${countOf(runs, 'attempt')}`;
        }
        else if (stats.runs.length > 1) {
            const failedAttempts = stats.runs
                .filter(it => it.failed)
                .map(it => it.error
                    ? DuelFetch.#errorSummary(it.error)
                    : `${it.status}`)
                .join(', ');
            stats.warnMessage = `Required ${countOf(stats.runs, 'attempt')} (${failedAttempts})`;
        }

        return stats;
    }

    async #evaluate(run, error) {

        if (error) {
            run.error = error;
        }
        else {
            run.status = this.response.status;
        }

        const {extension} = this;
        const retryConfig = extension.retry;

        if (isEmpty(retryConfig)) {
            return;
        }

        if (error) {
            if (DuelFetch.#isAbortError(error)) {
                if (extension.timeout) {
                    run.retryable = true;
                    error.reason = 'Timeout';
                }
                else {
                    /*
                     * Throw from user-specified AbortController
                     * overrides extension retry behaviour.
                     */
                    error.reason = this.fetchArgs[1]?.signal?.reason;
                }
            }
            else {
                const networkErrorCodes = [
                    // Source: https://github.com/sindresorhus/got/blob/main/documentation/7-retry.md
                    'EADDRINUSE', // Could not bind to any free port.
                    'EAI_AGAIN', // DNS lookup timed out.
                    'ECONNREFUSED', // The connection was refused by the server.
                    'ECONNRESET', // The connection was forcibly closed.
                    'ENETUNREACH', // No internet connection.
                    'ENOTFOUND', // Could not resolve the hostname to an IP address.
                    'EPIPE', // The remote side of the stream being written has been closed.
                    'ETIMEDOUT', // A connect or send request timeout.
                ];

                run.retryable = networkErrorCodes
                    .includes(DuelFetch.#errorCode(error));
            }
        }
        else {
            run.retryable = retryConfig.methods.includes(this.request.method)
                && isServerErrorCode(this.response.status);
        }
    }

    static #errorCode(error) {
        return (error.cause || error).code;
    }

    static #errorSummary(error) {

        const subject = error.cause || error;
        const {name, reason} = subject;

        return DuelFetch.#isAbortError(subject)
            ? `${name} (${reason})`
            : `${name} (${DuelFetch.#errorCode(subject)})`;
    }

    static #isAbortError(error) {
        return (error instanceof Error) && error.name === 'AbortError';
    }
}
