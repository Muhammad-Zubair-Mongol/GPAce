'use strict';

const express = require('express');
const { createConverter, ConversionError } = require('../services/converter');
const { createHttpError, sendError } = require('../middleware/errors');

function sendRouteError(res, req, error) {
    if (error instanceof ConversionError) {
        return sendError(res, createHttpError(error.status, error.code, error.publicMessage, { expose: true }), req);
    }
    return sendError(res, error, req);
}

function createConversionRouter(options = {}) {
    const converter = options.converter || createConverter(options.converterOptions || options);
    const router = express.Router();

    router.post('/convert', async (req, res, next) => {
        const controller = new AbortController();
        let result = null;
        let cleanupStarted = false;

        const abortConversion = () => {
            if (!controller.signal.aborted) controller.abort();
        };
        const cleanup = async () => {
            if (cleanupStarted || !result || typeof result.cleanup !== 'function') return;
            cleanupStarted = true;
            try {
                await result.cleanup();
            } catch {
                // Cleanup is best effort; the converter independently attempts every artifact.
            }
        };

        req.once('aborted', abortConversion);
        res.once('close', () => {
            if (!res.writableEnded) abortConversion();
        });

        try {
            result = await converter.convert(req.body && req.body.markdown, { signal: controller.signal });
            if (req.aborted) {
                await cleanup();
                return;
            }

            return res.download(result.outputPath, result.filename || 'converted_document.docx', async error => {
                await cleanup();
                req.removeListener('aborted', abortConversion);
                if (error && !res.headersSent) {
                    return sendRouteError(res, req, new ConversionError(500, 'DOWNLOAD_FAILED', 'Converted document could not be downloaded', { cause: error }));
                }
                return undefined;
            });
        } catch (error) {
            await cleanup();
            req.removeListener('aborted', abortConversion);
            if (res.headersSent || req.aborted) return;
            if (error instanceof ConversionError) return sendRouteError(res, req, error);
            return next(error);
        }
    });

    return router;
}

const router = createConversionRouter();

module.exports = router;
module.exports.router = router;
module.exports.createConversionRouter = createConversionRouter;
module.exports.sendRouteError = sendRouteError;
