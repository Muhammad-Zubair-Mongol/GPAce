'use strict';

const crypto = require('node:crypto');

const REQUEST_ID_HEADER = 'X-Request-Id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

class HttpError extends Error {
    constructor(status, code, message, options = {}) {
        super(message || code || 'Request failed');
        this.name = 'HttpError';
        this.status = Number.isInteger(status) ? status : 500;
        this.code = code || 'INTERNAL_ERROR';
        this.publicMessage = options.publicMessage || this.message;
        this.expose = options.expose !== undefined ? Boolean(options.expose) : this.status < 500;
        this.cause = options.cause;
    }
}

function createHttpError(status, code, message, options) {
    return new HttpError(status, code, message, options);
}

function getRequestId(req) {
    const requested = req && (
        req.requestId ||
        req.id ||
        (req.headers && (req.headers['x-request-id'] || req.headers['X-Request-Id']))
    );
    if (typeof requested === 'string' && REQUEST_ID_PATTERN.test(requested.trim())) {
        return requested.trim();
    }
    return crypto.randomUUID();
}

function sanitizePublicMessage(message) {
    if (typeof message !== 'string' || !message.trim()) {
        return 'Request failed';
    }

    return message
        .replace(/(authorization|api[-_ ]?key|x[-_ ]gemini[-_ ]key|secret|token|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
        .replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s"'<>]|[\\/]){2,}/g, '[redacted path]')
        .slice(0, 500);
}

function normalizeError(error) {
    if (error instanceof HttpError) {
        return {
            status: Math.min(599, Math.max(400, error.status)),
            code: String(error.code || 'INTERNAL_ERROR').toUpperCase(),
            message: error.expose ? sanitizePublicMessage(error.publicMessage) : 'Internal server error'
        };
    }

    const status = Number.isInteger(error && error.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500;
    const code = typeof (error && error.code) === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)
        ? error.code
        : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
    const canExpose = status < 500 && Boolean(error && (error.expose || error.publicMessage));

    return {
        status,
        code,
        message: canExpose
            ? sanitizePublicMessage(error.publicMessage || error.message)
            : 'Internal server error'
    };
}

function sendError(res, error, req) {
    const normalized = normalizeError(error);
    const requestId = getRequestId(req);

    if (!res.headersSent) {
        res.setHeader(REQUEST_ID_HEADER, requestId);
        res.status(normalized.status).json({
            error: {
                code: normalized.code,
                message: normalized.message,
                requestId
            }
        });
    }

    return requestId;
}

function createErrorMiddleware(options = {}) {
    const logger = typeof options.logger === 'function' ? options.logger : null;

    return function errorMiddleware(error, req, res, next) {
        if (res.headersSent) {
            if (typeof next === 'function') return next(error);
            return undefined;
        }

        if (logger) {
            // Log only a stable code and request ID.  Error messages may contain secrets or paths.
            logger({
                code: error && error.code ? String(error.code) : 'INTERNAL_ERROR',
                requestId: getRequestId(req)
            });
        }

        return sendError(res, error, req);
    };
}

function notFoundMiddleware(req, res) {
    return sendError(res, new HttpError(404, 'NOT_FOUND', 'Route not found'), req);
}

module.exports = {
    HttpError,
    createHttpError,
    createErrorMiddleware,
    getRequestId,
    normalizeError,
    notFoundMiddleware,
    sanitizePublicMessage,
    sendError,
    REQUEST_ID_HEADER
};
