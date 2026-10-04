'use strict';

const fsPromises = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { execFile: defaultExecFile } = require('node:child_process');

const DEFAULT_MAX_MARKDOWN_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

class ConversionError extends Error {
    constructor(status, code, publicMessage, options = {}) {
        super(publicMessage);
        this.name = 'ConversionError';
        this.status = status;
        this.code = code;
        this.publicMessage = publicMessage;
        this.cause = options.cause;
        this.cleanup = options.cleanup;
    }
}

function validateMarkdown(markdown, maxBytes = DEFAULT_MAX_MARKDOWN_BYTES) {
    if (typeof markdown !== 'string') {
        throw new ConversionError(400, 'INVALID_MARKDOWN', 'Markdown content must be a string');
    }
    const size = Buffer.byteLength(markdown, 'utf8');
    if (!markdown.trim()) {
        throw new ConversionError(400, 'INVALID_MARKDOWN', 'Markdown content is required');
    }
    if (size > maxBytes) {
        throw new ConversionError(413, 'MARKDOWN_TOO_LARGE', 'Markdown content exceeds the allowed size');
    }
    return markdown;
}

async function cleanupArtifacts(paths, fs = fsPromises) {
    const uniquePaths = [...new Set((paths || []).filter(value => typeof value === 'string' && value))];
    const filePaths = uniquePaths.filter(value => !value.endsWith(path.sep) && path.extname(value));
    const directories = uniquePaths.filter(value => !filePaths.includes(value));
    const results = [];

    // Each artifact gets its own promise.  One unlink failure must never prevent
    // cleanup of the remaining input/output files or their temporary directory.
    for (const filePath of filePaths) {
        results.push(await Promise.resolve().then(() => fs.unlink(filePath)).then(
            () => ({ path: filePath, ok: true }),
            error => ({ path: filePath, ok: false, error })
        ));
    }

    for (const directory of directories) {
        const remove = typeof fs.rm === 'function'
            ? () => fs.rm(directory, { recursive: true, force: true })
            : () => fs.rmdir(directory, { recursive: true });
        results.push(await Promise.resolve().then(remove).then(
            () => ({ path: directory, ok: true }),
            error => ({ path: directory, ok: false, error })
        ));
    }

    return results;
}

function createTimeoutError(timeoutMs) {
    const error = new Error(`Conversion process exceeded ${timeoutMs}ms`);
    error.code = 'ETIMEDOUT';
    error.killed = true;
    return error;
}

function runExecFile(execFile, command, args, options = {}) {
    const timeoutMs = Number.isFinite(options.timeout) ? options.timeout : DEFAULT_TIMEOUT_MS;
    const maxBuffer = Number.isFinite(options.maxBuffer) ? options.maxBuffer : DEFAULT_MAX_OUTPUT_BYTES;
    const signal = options.signal;

    return new Promise((resolve, reject) => {
        let child = null;
        let settled = false;
        let timer = null;
        let abortHandler = null;

        const finish = (error, stdout = '', stderr = '') => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);

            if (!error) {
                const outputSize = Buffer.byteLength(String(stdout || ''), 'utf8') + Buffer.byteLength(String(stderr || ''), 'utf8');
                if (outputSize > maxBuffer) {
                    const outputError = new Error('Conversion process output exceeded the configured limit');
                    outputError.code = 'ERR_OUTPUT_LIMIT';
                    return reject(outputError);
                }
                return resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), child });
            }
            return reject(error);
        };

        const abort = () => {
            if (child && typeof child.kill === 'function') {
                try { child.kill(); } catch {}
            }
            const error = new Error('Conversion was aborted');
            error.name = 'AbortError';
            error.code = 'ABORT_ERR';
            finish(error);
        };

        try {
            child = execFile(command, args, {
                ...options,
                timeout: timeoutMs,
                maxBuffer,
                windowsHide: true
            }, finish);
            if (child && typeof child.once === 'function') {
                child.once('error', error => finish(error));
            }
        } catch (error) {
            return finish(error);
        }

        if (!settled && timeoutMs > 0) timer = setTimeout(() => {
            if (child && typeof child.kill === 'function') {
                try { child.kill(); } catch {}
            }
            finish(createTimeoutError(timeoutMs));
        }, timeoutMs);

        if (!settled && signal) {
            if (signal.aborted) return abort();
            abortHandler = abort;
            signal.addEventListener('abort', abortHandler, { once: true });
        }
    });
}

class MarkdownConverter {
    constructor(options = {}) {
        this.fs = options.fs || fsPromises;
        this.execFile = options.execFile || defaultExecFile;
        this.os = options.os || os;
        this.tempRoot = options.tempRoot || this.os.tmpdir();
        this.command = options.command || process.env.PANDOC_PATH || 'pandoc';
        this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
        this.maxMarkdownBytes = Number.isFinite(options.maxMarkdownBytes)
            ? options.maxMarkdownBytes
            : DEFAULT_MAX_MARKDOWN_BYTES;
        this.maxOutputBytes = Number.isFinite(options.maxOutputBytes)
            ? options.maxOutputBytes
            : DEFAULT_MAX_OUTPUT_BYTES;
        this._toolCheck = null;
    }

    async checkTool(options = {}) {
        const signal = options.signal;
        try {
            const result = await runExecFile(this.execFile, this.command, ['--version'], {
                timeout: this.timeoutMs,
                maxBuffer: this.maxOutputBytes,
                signal
            });
            const match = `${result.stdout}\n${result.stderr}`.match(/pandoc\s+(\S+)/i);
            return { available: true, version: match ? match[1] : 'unknown' };
        } catch (error) {
            return {
                available: false,
                version: null,
                reason: error && error.code === 'ETIMEDOUT' ? 'timeout' : 'unavailable'
            };
        }
    }

    async checkPandoc(options = {}) {
        return this.checkTool(options);
    }

    async convert(markdown, options = {}) {
        validateMarkdown(markdown, this.maxMarkdownBytes);
        const tool = await this.checkTool({ signal: options.signal });
        if (!tool.available) {
            throw new ConversionError(503, 'CONVERTER_UNAVAILABLE', 'Document conversion is currently unavailable');
        }

        if (options.signal && options.signal.aborted) {
            throw new ConversionError(499, 'CONVERSION_ABORTED', 'Document conversion was aborted');
        }

        let tempDir;
        const artifacts = [];
        try {
            tempDir = await this.fs.mkdtemp(path.join(this.tempRoot, 'gpace-convert-'));
            const markdownPath = path.join(tempDir, 'input.md');
            const outputPath = path.join(tempDir, 'output.docx');
            artifacts.push(markdownPath, outputPath, tempDir);
            await this.fs.writeFile(markdownPath, markdown, 'utf8');

            const args = [
                '-f', 'markdown+tex_math_dollars+tex_math_single_backslash+pipe_tables+strikeout+task_lists',
                '-t', 'docx',
                '--mathml',
                '-s',
                '-o', outputPath,
                markdownPath
            ];

            await runExecFile(this.execFile, this.command, args, {
                timeout: this.timeoutMs,
                maxBuffer: this.maxOutputBytes,
                signal: options.signal
            });

            return {
                outputPath,
                inputPath: markdownPath,
                tempDir,
                filename: options.filename || 'converted_document.docx',
                tool,
                cleanup: () => cleanupArtifacts(artifacts, this.fs)
            };
        } catch (error) {
            await cleanupArtifacts(artifacts, this.fs);
            if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
                throw new ConversionError(499, 'CONVERSION_ABORTED', 'Document conversion was aborted', { cause: error });
            }
            if (error && error.code === 'ETIMEDOUT') {
                throw new ConversionError(504, 'CONVERSION_TIMEOUT', 'Document conversion exceeded its time limit', { cause: error });
            }
            throw new ConversionError(502, 'CONVERSION_FAILED', 'Document conversion failed', { cause: error });
        }
    }
}

function createConverter(options) {
    return new MarkdownConverter(options);
}

async function convertMarkdown(markdown, options = {}) {
    return createConverter(options).convert(markdown, options);
}

module.exports = {
    DEFAULT_MAX_MARKDOWN_BYTES,
    DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_TIMEOUT_MS,
    ConversionError,
    MarkdownConverter,
    cleanupArtifacts,
    convertMarkdown,
    createConverter,
    runExecFile,
    validateMarkdown
};
