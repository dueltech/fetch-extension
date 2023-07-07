import {Headers, Request, Response} from '#src/api.native';

export {default as httpMethods} from '#src/http-methods';
export * from '#src/http-methods';
export * as httpCodes from '#src/http-codes';
export * from '#src/http-codes';
export * as mimeTypes from '#src/mime-types';

export function isHeaders(it) {

    const candidates = [
        Headers,
    ];

    if (globalThis.Headers) {
        candidates.push(globalThis.Headers);
    }

    return isInstanceOf(it, ...candidates);
}

export function isRequest(it) {
    return it instanceof Request;
}

export function isResponse(it) {
    return it instanceof Response;
}

export function toHeaders(it) {
    return isHeaders(it)
        ? it
        : new Headers(it);
}

function isInstanceOf(object, ...constructors) {
    return constructors
        .some(it => object instanceof it);
}
