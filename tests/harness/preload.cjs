/**
 * Preload script for isolated test executions.
 * Installs network guard by default to prevent tests from contacting
 * external/production networks.
 */

const { installNetworkGuard } = require('./helpers.cjs');

// Install network guard automatically in test runners
installNetworkGuard({
  allowedHosts: ['localhost', '127.0.0.1', '::1']
});
