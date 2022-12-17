import {Headers, Request, Response} from '#src/api.native';

export {default as httpMethods} from '#src/httpMethods';
export * from '#src/httpMethods';
export * as httpCodes from '#src/httpCodes';
export * from '#src/httpCodes';
export * as mimeTypes from '#src/mimeTypes';

export function isHeaders(it) {
    return it instanceof Headers;
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
