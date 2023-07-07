import {defaults, isEmpty, isFunction, isNil, sum} from 'lodash-es';
import {fetch, Request} from '#src/api.native';
import {toHeaders} from '#src/api.util';
import {isServerErrorCode} from '#src/http-codes';
import * as httpMethods from '#src/http-methods';
import * as mimeTypes from '#src/mime-types';
import {assign, countOf, defineProperties, ms, sleep} from '#src/util';

export async function fetchEx(url, options) {

    const extension = options?.extension;

    if (extension) {
        delete options.extension;
    }

    const request = new FetchEx([url, options], extension);

    return request.fetch();
}

class FetchEx {

    constructor(fetchArgs, extension={}) {

        const defaultExtension = {
            retry: {
                delay: '100 ms',
                limit: 1,
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

        fetchArgs[1] ||= {};

        if (extension.timeout) {
            extension.timeout = ms(extension.timeout);
            if (fetchArgs[1].signal) {
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
                if (extension.timeout) {
                    const controller = new AbortController();
                    this.fetchArgs[1].signal = controller.signal;
                    run.timeout = setTimeout(() => {
                        controller.abort(`Timeout <${extension.timeout} ms>`);
                    }, extension.timeout);
                }

                const [fetchURL] = this.fetchArgs;
                const fetchOpts = {
                    ...this.fetchArgs[1],
                    ...(extension.agent && {
                        agent: extension.agent,
                    }),
                };

                if (! isNil(extension.json)) {
                    fetchOpts.body ??= JSON.stringify(extension.json);
                    fetchOpts.headers = toHeaders(fetchOpts.headers);

                    for (const name of ['content-type', 'accept']) {
                        if (! fetchOpts.headers.has(name)) {
                            fetchOpts.headers.set(name, mimeTypes.json);
                        }
                    }
                }

                this.request = new Request(fetchURL, fetchOpts);
                this.response = await fetch(this.request);

                await this.#evaluate(run);
            }
            catch (error) {
                await this.#evaluate(run, error);
            }
            finally {
                if (run.timeout) {
                    clearTimeout(run.timeout);
                    delete run.timeout;
                }
            }

            runs.push(defineProperties(run, {
                ...(extension.debug && {
                    request: {
                        enumerable: true,
                        value: this.request,
                    },
                }),
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

        const stats = this.#stats(runs);

        extension.onComplete?.(stats);

        for (const status of ['fail', 'ok', 'warn']) {
            if (stats[status] && isFunction(extension.log?.[status])) {
                extension.log[status](stats[status]);
            }
        }

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

        const prefix = `Fetch of '${this.request.url}' `;

        if (stats.lastRun.failed) {
            const {error} = stats.lastRun;
            stats.fail = prefix + (error
                ? `failed with ${FetchEx.#errorSummary(error)}`
                : `failed with status ${stats.lastRun.status}`)
                + ` after ${countOf(runs, 'attempt')}`;
        }
        else if (stats.runs.length > 1) {
            const failedAttempts = stats.runs
                .filter(it => it.failed)
                .map(it => it.error
                    ? FetchEx.#errorSummary(it.error)
                    : `${it.status}`)
                .join(', ');
            stats.warn = `${prefix}required ${countOf(stats.runs, 'attempt')} (${failedAttempts})`;
        }
        else {
            stats.ok = `${prefix}was OK`;
        }

        return stats;
    }

    async #evaluate(run, error) {

        if (error) {
            if (error instanceof TypeError) {
                /*
                 * May be thrown by misconfigured Request.
                 * E.g. options with `body` and GET method.
                 */
                throw error;
            }
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
            if (FetchEx.#isAbortError(error)) {
                if (extension.timeout) {
                    run.retryable = true;
                }
                else {
                    /*
                     * Throw from user-specified AbortController
                     * overrides extension retry behaviour.
                     */
                }
                error.reason = this.fetchArgs[1].signal.reason;
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
                    .includes(FetchEx.#errorCode(error));
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

        return FetchEx.#isAbortError(subject)
            ? `${name} (${reason})`
            : `${name} (${FetchEx.#errorCode(subject)})`;
    }

    static #isAbortError(error) {
        return (error instanceof Error) && error.name === 'AbortError';
    }
}
