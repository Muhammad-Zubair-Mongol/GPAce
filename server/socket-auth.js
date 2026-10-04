'use strict';

const {
  configureSocketAuthorization,
  roomForUser
} = require('./services/analysis-jobs');

function defaultVerifyIdToken() {
  return async token => {
    let getAuth;
    try {
      ({ getAuth } = require('firebase-admin/auth'));
    } catch {
      throw new Error('Authentication service unavailable');
    }

    return getAuth().verifyIdToken(token);
  };
}

function resolveVerifier(options = {}) {
  if (typeof options.verifyIdToken === 'function') return options.verifyIdToken;
  if (typeof options.authenticate === 'function') return options.authenticate;
  if (typeof options.auth === 'function') return options.auth;
  if (options.auth && typeof options.auth.verifyIdToken === 'function') {
    return options.auth.verifyIdToken;
  }
  return defaultVerifyIdToken();
}

function createSocketAuthMiddleware(options = {}) {
  const verifyIdToken = resolveVerifier(options);
  return require('./services/analysis-jobs').createSocketAuthMiddleware({ verifyIdToken });
}

function configureSocketAuth(io, options = {}) {
  return configureSocketAuthorization(io, {
    ...options,
    verifyIdToken: resolveVerifier(options)
  });
}

module.exports = {
  configureSocketAuth,
  configureSocketAuthorization: configureSocketAuth,
  createSocketAuthMiddleware,
  createSocketAuthorization: createSocketAuthMiddleware,
  installSocketAuth: configureSocketAuth,
  roomForUser,
  resolveVerifier
};
