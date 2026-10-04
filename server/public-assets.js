'use strict';

const express = require('express');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const DEFAULT_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DEFAULT_HTML_CACHE_CONTROL = 'no-cache';

function isContained(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function getPathname(req) {
    const rawUrl = typeof req.originalUrl === 'string' ? req.originalUrl : req.url;
    const rawPath = String(rawUrl || '/').split('?')[0];
    if (rawPath.includes('\0')) return null;
    try {
        return decodeURIComponent(rawPath);
    } catch {
        return null;
    }
}

function hasDotSegment(pathname) {
    return pathname.split('/').some(segment => segment.startsWith('.'));
}

async function nearestExistingRealpath(candidate) {
    let current = candidate;
    while (true) {
        try {
            return await fsp.realpath(current);
        } catch (error) {
            if (!error || !['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
            const parent = path.dirname(current);
            if (parent === current) return null;
            current = parent;
        }
    }
}

async function isSafeRequestPath(root, rootRealpath, pathname) {
    if (!pathname || !pathname.startsWith('/') || pathname.includes('\\') || hasDotSegment(pathname)) {
        return false;
    }

    const candidate = path.resolve(root, `.${pathname}`);
    if (!isContained(candidate, root)) return false;

    const existing = await nearestExistingRealpath(candidate);
    return Boolean(existing && isContained(existing, rootRealpath));
}

function normalizeFactoryArguments(buildDirOrOptions, maybeOptions = {}) {
    if (typeof buildDirOrOptions === 'string') {
        return { ...maybeOptions, buildDir: buildDirOrOptions };
    }
    if (buildDirOrOptions && typeof buildDirOrOptions === 'object' && !Array.isArray(buildDirOrOptions)) {
        return { ...buildDirOrOptions };
    }
    throw new TypeError('A buildDir is required; public assets cannot default to the repository root');
}

function validateBuildDirectory(buildDir) {
    if (typeof buildDir !== 'string' || !path.isAbsolute(buildDir)) {
        throw new TypeError('buildDir must be an absolute path to the built public assets');
    }

    const root = path.resolve(buildDir);
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) throw new TypeError('buildDir must be a directory');
    return {
        root,
        rootRealpath: fs.realpathSync.native ? fs.realpathSync.native(root) : fs.realpathSync(root)
    };
}

function isAssetRequest(pathname) {
    return /\.(?:css|js|mjs|json|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|webmanifest|wasm)$/i.test(pathname);
}

function createPublicAssets(buildDirOrOptions, maybeOptions) {
    const options = normalizeFactoryArguments(buildDirOrOptions, maybeOptions);
    const { root, rootRealpath } = validateBuildDirectory(options.buildDir);
    const indexName = options.indexName || 'index.html';
    const indexPath = path.join(root, indexName);
    if (!isContained(indexPath, root)) throw new TypeError('indexName must stay inside buildDir');

    const assetCacheControl = options.assetCacheControl || DEFAULT_ASSET_CACHE_CONTROL;
    const htmlCacheControl = options.htmlCacheControl || DEFAULT_HTML_CACHE_CONTROL;
    const router = express.Router();

    router.use(async (req, res, next) => {
        // A downstream handler can finish a response before an async asset
        // check resumes. Never mutate headers after that point.
        if (res.headersSent) return next();
        try {
            res.setHeader('X-Content-Type-Options', 'nosniff');
        } catch (error) {
            if (res.headersSent) return next();
            return next(error);
        }
        const pathname = getPathname(req);
        if (!pathname) return res.status(404).end();

        const safe = await isSafeRequestPath(root, rootRealpath, pathname).catch(() => false);
        if (!safe) return res.status(404).end();
        req.publicAssetPathname = pathname;
        return next();
    });

    // Headers are applied before express.static so static files and the fallback
    // share the same cache and content-sniffing policy.
    router.use((req, res, next) => {
        if (res.headersSent) return next();
        const pathname = req.publicAssetPathname || getPathname(req) || '/';
        if (isAssetRequest(pathname)) {
            res.setHeader('Cache-Control', assetCacheControl);
        } else if (/\.html$/i.test(pathname) || pathname === '/' || !path.extname(pathname)) {
            res.setHeader('Cache-Control', htmlCacheControl);
        }
        next();
    });

    router.use(express.static(root, {
        dotfiles: 'deny',
        fallthrough: true,
        index: 'index.html',
        redirect: false,
        etag: true,
        setHeaders(res, filePath) {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            if (isAssetRequest(filePath)) res.setHeader('Cache-Control', assetCacheControl);
            if (path.extname(filePath).toLowerCase() === '.html') res.setHeader('Cache-Control', htmlCacheControl);
        }
    }));

    // Only browser navigation requests get the SPA entry point.  API, upload,
    // source and archive paths must continue to return a real 404.
    router.use((req, res, next) => {
        const pathname = req.publicAssetPathname || getPathname(req) || '/';
        const acceptsHtml = typeof req.headers.accept === 'string' && req.headers.accept.includes('text/html');
        const isNavigation = req.method === 'GET' && acceptsHtml &&
            !pathname.startsWith('/api/') && !pathname.startsWith('/uploads/') &&
            !path.extname(pathname) && pathname !== '/';

        if (!isNavigation) return next();
        return res.sendFile(indexPath, {
            dotfiles: 'deny',
            headers: {
                'Cache-Control': htmlCacheControl,
                'X-Content-Type-Options': 'nosniff'
            }
        }, error => {
            if (error && !res.headersSent) next(error);
        });
    });

    return router;
}

module.exports = {
    DEFAULT_ASSET_CACHE_CONTROL,
    DEFAULT_HTML_CACHE_CONTROL,
    createPublicAssetBoundary: createPublicAssets,
    createPublicAssetMiddleware: createPublicAssets,
    createPublicAssets,
    createPublicAssetsMiddleware: createPublicAssets,
    isContained,
    isSafeRequestPath,
    validateBuildDirectory
};
