import {defaults, isEmpty, sum} from 'lodash-es';
import {isServerErrorCode} from '#src/httpCodes';
import * as httpMethods from '#src/httpMethods';
import * as mimeTypes from '#src/mimeTypes';
import {assign, checkType, countOf, defineProperties, ms, sleep} from '#src/util';

export async function duelFetch(url, options) {

    const extension = options?.extension;

    if (extension) {
        delete options.extension;
    }

    const request = new DuelFetch([url, options], extension);

    return request.fetch();
}

export class DuelFetch {

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
                    body: () => DuelFetch.body(this.response),
                    stats: this.#stats(runs),
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
                    'ECONNRESET', // The connection was forcibly closed.
                    'EADDRINUSE', // Could not bind to any free port.
                    'ECONNREFUSED', // The connection was refused by the server.
                    'EPIPE', // The remote side of the stream being written has been closed.
                    'ENOTFOUND', // Could not resolve the hostname to an IP address.
                    'ENETUNREACH', // No internet connection.
                    'EAI_AGAIN', // DNS lookup timed out.
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

    /*
     * Infer body parser based on content-type.
     */
    static async body(response) {

        checkType(response, Response);

        const responseType = response.headers
            .get('content-type') || '';

        return responseType.includes(mimeTypes.json)
            ? response.json()
            : response.text();
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
