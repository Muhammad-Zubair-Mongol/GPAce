'use strict';

const {
    createHttpError,
    getRequestId,
    sendError
} = require('./errors');

function parseBearerToken(header) {
    if (typeof header !== 'string') return null;
    const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
    return match ? match[1] : null;
}

function resolveVerifier(options = {}) {
    if (typeof options === 'function') return options;
    if (typeof options.verifyIdToken === 'function') return options.verifyIdToken;
    if (options.auth && typeof options.auth.verifyIdToken === 'function') {
        return token => options.auth.verifyIdToken(token);
    }
    if (options.firebaseAuth && typeof options.firebaseAuth.verifyIdToken === 'function') {
        return token => options.firebaseAuth.verifyIdToken(token);
    }

    // Keep Firebase optional for isolated tests and for consumers that inject an
    // emulator or a service-account-backed verifier.  Loading it is deferred until
    // an authenticated request is actually received.
    return token => {
        let getAuth;
        try {
            ({ getAuth } = require('firebase-admin/auth'));
        } catch {
            throw createHttpError(503, 'AUTH_UNAVAILABLE', 'Authentication service unavailable', { expose: true });
        }

        try {
            return getAuth().verifyIdToken(token);
        } catch (error) {
            throw error;
        }
    };
}

function createAuthMiddleware(options = {}) {
    const verifyIdToken = resolveVerifier(options);
    const headerName = options.headerName || 'authorization';

    return async function authenticate(req, res, next) {
        const token = parseBearerToken(req.headers && req.headers[headerName.toLowerCase()]);
        if (!token) {
            return sendError(res, createHttpError(401, 'AUTH_REQUIRED', 'Authentication required', { expose: true }), req);
        }

        let decoded;
        try {
            decoded = await verifyIdToken(token);
        } catch {
            return sendError(res, createHttpError(401, 'AUTH_INVALID', 'Invalid authentication token', { expose: true }), req);
        }

        if (!decoded || typeof decoded !== 'object' || typeof decoded.uid !== 'string' || !decoded.uid.trim()) {
            return sendError(res, createHttpError(401, 'AUTH_INVALID', 'Invalid authentication token', { expose: true }), req);
        }

        // The verified token is the only source of identity for downstream code.
        req.user = { ...decoded, uid: decoded.uid };
        req.auth = req.user;
        req.authenticatedUid = req.user.uid;
        req.requestId = getRequestId(req);
        return next();
    };
}

function resolveOwnershipValue(req, options = {}) {
    if (typeof options.getOwner === 'function') {
        return options.getOwner(req);
    }

    const field = options.field || options.param || options.userIdParam || 'userId';
    const sources = [req.params, req.body, req.query];
    for (const source of sources) {
        if (source && Object.prototype.hasOwnProperty.call(source, field)) {
            return source[field];
        }
    }

    return undefined;
}

function createOwnershipMiddleware(options = {}) {
    if (typeof options === 'string') options = { field: options };
    if (typeof options === 'function') options = { getOwner: options };

    return function requireOwnership(req, res, next) {
        const uid = req.user && req.user.uid;
        if (typeof uid !== 'string' || !uid) {
            return sendError(res, createHttpError(401, 'AUTH_REQUIRED', 'Authentication required', { expose: true }), req);
        }

        const requestedOwner = resolveOwnershipValue(req, options);
        if (requestedOwner !== undefined && requestedOwner !== null && String(requestedOwner) !== uid) {
            return sendError(res, createHttpError(403, 'FORBIDDEN', 'You do not own this resource', { expose: true }), req);
        }

        // Routes may use this value for storage keys instead of reading a client field.
        req.ownerUid = uid;
        return next();
    };
}

function createOriginPolicy(options = {}) {
    const configured = options.allowedOrigins || options.origins || [];
    const allowedOrigins = new Set(
        (Array.isArray(configured) ? configured : [configured])
            .filter(origin => typeof origin === 'string' && origin.trim())
            .map(origin => origin.trim())
    );
    const allowOrigin = typeof options.allowOrigin === 'function'
        ? options.allowOrigin
        : origin => allowedOrigins.has(origin);
    const allowCredentials = options.credentials !== false;
    const methods = options.methods || 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS';
    const headers = options.allowedHeaders || 'Authorization, Content-Type, X-Request-Id';

    return function originPolicy(req, res, next) {
        const origin = req.headers && req.headers.origin;
        if (!origin) return next();

        let allowed = false;
        try {
            allowed = Boolean(allowOrigin(origin, req));
        } catch {
            allowed = false;
        }

        if (!allowed) {
            return sendError(res, createHttpError(403, 'ORIGIN_DENIED', 'Origin is not allowed', { expose: true }), req);
        }

        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        if (allowCredentials) res.setHeader('Access-Control-Allow-Credentials', 'true');

        if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Methods', methods);
            res.setHeader('Access-Control-Allow-Headers', headers);
            return res.status(204).end();
        }

        return next();
    };
}

module.exports = {
    createAuthMiddleware,
    createCorsMiddleware: createOriginPolicy,
    createOriginPolicy,
    createOwnershipMiddleware,
    ensureAuthenticated: createAuthMiddleware,
    parseBearerToken,
    requireAuth: createAuthMiddleware,
    requireOwnership: createOwnershipMiddleware,
    resolveVerifier
};
