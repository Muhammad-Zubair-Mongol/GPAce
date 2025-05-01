/**
 * Google Drive API Integration Module (Modified for Firebase Auth Sync)
 * Handles file uploads, retrieval and management through Google Drive API
 */

class GoogleDriveAPI {
    constructor() {
        // Keep scopes, client_id, api_key
        this.SCOPES = [
            'https://www.googleapis.com/auth/drive.file',
            // 'https://www.googleapis.com/auth/drive.appdata' // Only if needed
        ];
        this.CLIENT_ID = '949014366726-b6tfica8j4il3ldqpoffh9m5u66gjs8q.apps.googleusercontent.com'; // Make sure this matches Google Cloud Console
        this.API_KEY = 'AIzaSyBZrMVZqDkYfuHWJgLeHJYxoHEqXqYm0Yk'; // Ensure this is correct

        // Simplify state
        this.gapiLoaded = false;
        this.gisLoaded = false;
        this.isAuthorized = false; // Tracks Drive API specific authorization

        this.tokenClient = null; // Will be initialized later
        this.tokenRefreshInterval = null; // For periodic token refresh

        // Keep file configurations and preview dialog logic
        this.maxFileSize = 500 * 1024 * 1024; // 500MB
        this.allowedFileTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain', 'text/markdown', 'text/csv'
        ];
        this.maxConcurrentUploads = 3;
        this.activeUploads = 0;
        this.previewDialog = null;
        this.initializePreviewDialog();

        // Flag to prevent multiple initializations
        this._isInitializing = false;
        this._initializationPromise = null;

        // Start periodic token refresh when authorized
        window.addEventListener('google-drive-authenticated', () => {
            this.startPeriodicTokenRefresh();
        });

        // Stop token refresh when signed out
        window.addEventListener('google-drive-signed-out', () => {
            this.stopPeriodicTokenRefresh();
        });
    }

    /**
     * Initialize GAPI and GIS libraries if not already done.
     */
    async ensureLibrariesLoaded() {
        if (this.gapiLoaded && this.gisLoaded) {
            // Check if we have a valid token in localStorage
            const savedToken = localStorage.getItem('gdriveToken');
            if (savedToken) {
                try {
                    const tokenData = JSON.parse(savedToken);
                    // Add buffer time to ensure token doesn't expire during use
                    const EXPIRY_BUFFER = 5 * 60 * 1000; // 5 minutes in milliseconds
                    if (tokenData.expires_at && tokenData.expires_at > (Date.now() + EXPIRY_BUFFER)) {
                        console.log('Drive API: Using saved token from localStorage');
                        gapi.client.setToken(tokenData);
                        this.isAuthorized = true;
                        // Dispatch event to notify other components
                        window.dispatchEvent(new CustomEvent('google-drive-authenticated'));
                        return true;
                    } else {
                        console.log('Drive API: Saved token expired or expiring soon');
                        localStorage.removeItem('gdriveToken');
                        gapi.client.setToken(null);
                    }
                } catch (e) {
                    console.warn('Drive API: Error parsing saved token:', e);
                    localStorage.removeItem('gdriveToken');
                    gapi.client.setToken(null);
                }
            }
            return true;
        }
        // If initialization is already in progress, wait for it
        if (this._isInitializing && this._initializationPromise) {
            console.log('Drive API: Waiting for ongoing library initialization...');
            return this._initializationPromise;
        }

        this._isInitializing = true;
        console.log('Drive API: Starting library initialization...');

        this._initializationPromise = (async () => {
            try {
                 // Load GAPI Client
                if (!window.gapi || !this.gapiLoaded) {
                    console.log('Drive API: Loading gapi script...');
                    await this.loadScript('https://apis.google.com/js/api.js');
                    await new Promise((resolve, reject) => {
                        window.gapi.load('client', async () => {
                            try {
                                console.log('Drive API: Initializing gapi client core...');
                                // Init with API Key only first
                                await window.gapi.client.init({ apiKey: this.API_KEY });
                                console.log('Drive API: Gapi client core initialized.');
                                this.gapiLoaded = true;
                                resolve();
                            } catch (error) {
                                console.error('Drive API: Gapi client core init error:', error);
                                this.gapiLoaded = false; // Reset on error
                                reject(error);
                            }
                        });
                    });
                 }

                 // Load Google Identity Services (GIS)
                if (!window.google || !this.gisLoaded) {
                    console.log('Drive API: Loading GIS script...');
                    await this.loadScript('https://accounts.google.com/gsi/client');
                    console.log('Drive API: GIS script loaded.');

                    // Initialize the tokenClient once GIS is loaded
                    if (!this.tokenClient) {
                        this.tokenClient = google.accounts.oauth2.initTokenClient({
                            client_id: this.CLIENT_ID,
                            scope: this.SCOPES.join(' '),
                            prompt: '', // Start with no prompt
                            callback: (tokenResponse) => {
                                // This callback handles responses from requestAccessToken
                                if (tokenResponse && tokenResponse.access_token) {
                                    console.log('Drive API: Token client callback received token.');
                                    // Add expiration time to token data
                                    const tokenData = {
                                        ...tokenResponse,
                                        expires_at: Date.now() + (tokenResponse.expires_in * 1000)
                                    };
                                    // Save token to localStorage
                                    localStorage.setItem('gdriveToken', JSON.stringify(tokenData));
                                    // GAPI client will use this token if set via gapi.client.setToken
                                    // Setting isAuthorized and dispatching event is crucial
                                    this.isAuthorized = true;
                                    window.dispatchEvent(new CustomEvent('google-drive-authenticated'));
                                } else if (tokenResponse && tokenResponse.error) {
                                    console.error('Drive API: Token client callback error:', tokenResponse.error, tokenResponse);
                                    this.isAuthorized = false;
                                    window.dispatchEvent(new CustomEvent('google-drive-auth-failed', { detail: tokenResponse }));
                                } else {
                                    // Handle cases where the popup might be closed without error/token
                                    console.warn('Drive API: Token client callback received no token or error.');
                                    this.isAuthorized = false;
                                    window.dispatchEvent(new CustomEvent('google-drive-auth-failed', { detail: { error: 'popup_closed_or_failed' } }));
                                }
                            },
                             error_callback: (error) => { // Add error_callback for robustness
                                console.error('Drive API: Token client general error:', error);
                                this.isAuthorized = false;
                                window.dispatchEvent(new CustomEvent('google-drive-auth-failed', { detail: error }));
                            }
                        });
                        this.gisLoaded = true;
                        console.log('Drive API: GIS loaded and tokenClient initialized.');
                    } else {
                         this.gisLoaded = true; // Already initialized
                    }
                }

                // Load the Drive API discovery document AFTER GAPI client core is initialized
                if (this.gapiLoaded && gapi.client && !gapi.client.drive) {
                     try {
                         console.log('Drive API: Loading Drive discovery document...');
                         // Try the direct initialization approach instead of using discovery doc
                         await gapi.client.load('drive', 'v3');
                         console.log('Drive API: Drive API loaded directly.');
                     } catch(discoveryError) {
                         console.error("Drive API: Error loading Drive API directly:", discoveryError);
                         try {
                             // Fallback to manual initialization if discovery doc fails
                             console.log('Drive API: Attempting manual API initialization...');
                             gapi.client.drive = {
                                 files: {
                                     list: (params) => gapi.client.request({
                                         path: 'https://www.googleapis.com/drive/v3/files',
                                         method: 'GET',
                                         params: params
                                     }),
                                     get: (params) => gapi.client.request({
                                         path: `https://www.googleapis.com/drive/v3/files/${params.fileId}`,
                                         method: 'GET',
                                         params: params
                                     }),
                                     create: (params) => gapi.client.request({
                                         path: 'https://www.googleapis.com/drive/v3/files',
                                         method: 'POST',
                                         params: params.params || {},
                                         body: params.body || {}
                                     }),
                                     delete: (params) => gapi.client.request({
                                         path: `https://www.googleapis.com/drive/v3/files/${params.fileId}`,
                                         method: 'DELETE'
                                     }),
                                     update: (params) => gapi.client.request({
                                         path: `https://www.googleapis.com/drive/v3/files/${params.fileId}`,
                                         method: 'PATCH',
                                         params: params.params || {},
                                         body: params.body || {}
                                     })
                                 },
                                 permissions: {
                                     create: (params) => gapi.client.request({
                                         path: `https://www.googleapis.com/drive/v3/files/${params.fileId}/permissions`,
                                         method: 'POST',
                                         body: params.resource || {}
                                     })
                                 }
                             };
                             console.log('Drive API: Manual API initialization complete.');
                         } catch (manualInitError) {
                             console.error("Drive API: Manual initialization failed:", manualInitError);
                             throw manualInitError;
                         }
                     }
                }

                console.log('Drive API: Library initialization complete.');
                return true; // Indicate success
            } catch (error) {
                console.error('Drive API: Failed to load Google libraries:', error);
                this.gapiLoaded = false; // Reset flags on failure
                this.gisLoaded = false;
                this.tokenClient = null;
                return false; // Indicate failure
            } finally {
                 this._isInitializing = false;
                 // Keep _initializationPromise null until next attempt
            }
        })();
        return this._initializationPromise;
    }

    /**
     * Load a script dynamically
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            // Check if script already exists
            if (document.querySelector(`script[src="${src}"]`)) {
                 console.log(`Script already loaded: ${src}`);
                 resolve();
                 return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.defer = true;
            script.onload = resolve;
            script.onerror = (err) => {
                 console.error(`Failed to load script: ${src}`, err);
                 reject(err);
            }
            document.head.appendChild(script);
        });
    }
/**
 * Checks if the user is authorized for Drive API
 * Adding this to fix the error in taskAttachments.js:446
 * @returns {Promise<boolean>} True if authorized
 */
async checkAuthStatus() {
  try {
    await this.ensureLibrariesLoaded();
    return this.isAuthorized;
  } catch (error) {
    console.error('Drive API: Error checking auth status:', error);
    return false;
  }
}

/**
 * Initialize the Drive API - required by grind.html:910
 * @param {boolean} retry - Whether to retry initialization if it fails
 * @returns {Promise<boolean>} Whether initialization was successful
 */
async initialize(retry = true) {
  console.log('Drive API: Initializing...');
  try {
    // First try to load libraries
    await this.ensureLibrariesLoaded();

    // Check if Drive API is available
    if (!gapi.client.drive) {
      console.warn('Drive API: Drive client not available after library load, attempting direct initialization...');

      try {
        // Try direct initialization
        await gapi.client.load('drive', 'v3');
        console.log('Drive API: Drive API loaded directly during initialization.');
      } catch (directLoadError) {
        console.error("Drive API: Error loading Drive API directly during initialization:", directLoadError);

        // Fall back to manual initialization
        console.log('Drive API: Attempting manual API initialization...');
        gapi.client.drive = {
          files: {
            list: (params) => gapi.client.request({
              path: 'https://www.googleapis.com/drive/v3/files',
              method: 'GET',
              params: params
            }),
            get: (params) => gapi.client.request({
              path: `https://www.googleapis.com/drive/v3/files/${params.fileId}`,
              method: 'GET',
              params: params
            }),
            create: (params) => gapi.client.request({
              path: 'https://www.googleapis.com/drive/v3/files',
              method: 'POST',
              params: params.params || {},
              body: params.body || {}
            }),
            delete: (params) => gapi.client.request({
              path: `https://www.googleapis.com/drive/v3/files/${params.fileId}`,
              method: 'DELETE'
            }),
            update: (params) => gapi.client.request({
              path: `https://www.googleapis.com/drive/v3/files/${params.fileId}`,
              method: 'PATCH',
              params: params.params || {},
              body: params.body || {}
            })
          },
          permissions: {
            create: (params) => gapi.client.request({
              path: `https://www.googleapis.com/drive/v3/files/${params.fileId}/permissions`,
              method: 'POST',
              body: params.resource || {}
            })
          }
        };
        console.log('Drive API: Manual API initialization complete.');
      }
    }

    // Final check if Drive API is available
    if (!gapi.client.drive) {
      throw new Error("Drive API client not available after initialization attempts");
    }

    console.log('Drive API: Initialized successfully');
    return true;
  } catch (error) {
    console.error('Drive API: Initialization failed:', error);

    // Retry once with a delay if requested
    if (retry) {
      console.log('Drive API: Retrying initialization after 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return this.initialize(false); // Retry once without further retries
    }

    return false;
  }
}


    /**
     * Called by auth.js when Firebase user signs in.
     */
     async handleFirebaseSignIn() {
        console.log('Drive API: Handling Firebase Sign In...');
        try {
            const loaded = await this.ensureLibrariesLoaded();
            if (!loaded) {
                throw new Error("Google libraries failed to load. Cannot sync Drive auth.");
            }

            // Attempt to get token silently since scopes should have been granted
            console.log('Drive API: Attempting silent authorization post-Firebase sign-in...');
            await this.authorize(true); // Use the authorize method

        } catch (error) {
            console.error('Drive API: Error during post-Firebase sign-in handling:', error);
            this.isAuthorized = false; // Ensure state reflects failure
            // Do not throw, let the app continue. Drive features will fail until manually authorized.
        }
    }

    /**
     * Called by auth.js when Firebase user signs out.
     */
    handleFirebaseSignOut() {
        console.log('Drive API: Handling Firebase Sign Out...');
        // Clear token from localStorage
        localStorage.removeItem('gdriveToken');
        // Clear token GAPI client might be holding
        if (window.gapi && window.gapi.client) {
            try {
                gapi.client.setToken(null);
                console.log('Drive API: Gapi client token cleared.');
            } catch (e) {
                console.warn("Drive API: Error clearing gapi client token:", e);
            }
        }
        this.isAuthorized = false;
        console.log('Drive API: Authorization status set to false.');
        window.dispatchEvent(new CustomEvent('google-drive-signed-out'));
    }



    /**
     * Authorize the user for Drive API.
     * @param {boolean} silent - If true, attempt authorization without prompting the user ('').
     *                             If false, allow prompt ('consent').
     * @returns {Promise<boolean>} True if authorization is successful.
     */
    async authorize(silent = false) {
        const promptMode = silent ? '' : 'consent';
        console.log(`Drive API: Attempting authorization (Prompt: '${promptMode || 'none'}')...`);

        const loaded = await this.ensureLibrariesLoaded();
        if (!loaded || !this.tokenClient) {
            throw new Error("Cannot authorize, Google libraries/tokenClient not ready.");
        }

        // Check if GAPI client already has a valid token
        const currentToken = gapi.client.getToken();
        if (currentToken && currentToken.access_token) {
            // Check token expiration with buffer time
            const EXPIRY_BUFFER = 5 * 60 * 1000; // 5 minutes buffer
            if (currentToken.expires_at && currentToken.expires_at > (Date.now() + EXPIRY_BUFFER)) {
                console.log('Drive API: Using valid token from GAPI client.');
                if (!this.isAuthorized) { // Sync state if needed
                    this.isAuthorized = true;
                    window.dispatchEvent(new CustomEvent('google-drive-authenticated'));
                }
                return true;
            } else {
                console.log('Drive API: Token expired or expiring soon, attempting silent refresh...');
                try {
                    // Clear expired token but keep email hint
                    const userEmail = localStorage.getItem('lastSignedInEmail');
                    gapi.client.setToken(null);
                    localStorage.removeItem('gdriveToken');

                    // Attempt silent token refresh
                    if (userEmail) {
                        this.tokenClient.hint = userEmail;
                    }
                    this.tokenClient.prompt = '';
                    await new Promise((resolve, reject) => {
                        this.tokenClient.requestAccessToken({ prompt: '' });
                        // Response will be handled in the tokenClient callback
                        setTimeout(() => resolve(), 1000); // Brief delay for callback
                    });
                    return true;
                } catch (refreshError) {
                    console.warn('Drive API: Silent refresh failed:', refreshError);
                    if (!silent) {
                        // If not in silent mode, clear token and continue to prompt
                        gapi.client.setToken(null);
                        localStorage.removeItem('gdriveToken');
                    } else {
                        throw refreshError; // Propagate error in silent mode
                    }
                }
            }
        }

        console.log('Drive API: No valid token in gapi client, requesting access...');
        this.isAuthorized = false; // Assume not authorized until proven otherwise


        return new Promise((resolve, reject) => {
            try {
                // Define listeners *before* requesting token
                const successListener = () => {
                    cleanupListeners();
                    console.log("Drive API: Authorization successful (event received).");
                    this.isAuthorized = true; // Ensure state is correct
                    resolve(true);
                };
                const failureListener = (event) => {
                    cleanupListeners();
                    const errorDetail = event.detail || { error: 'unknown_failure' };
                    console.warn("Drive API: Authorization failed (event received).", errorDetail);
                    this.isAuthorized = false;
                    reject(new Error(`Drive authorization failed: ${errorDetail.error || 'User interaction required or failed.'}`));
                };
                const cleanupListeners = () => {
                     window.removeEventListener('google-drive-authenticated', successListener);
                     window.removeEventListener('google-drive-auth-failed', failureListener);
                     clearTimeout(timeoutId);
                };

                window.addEventListener('google-drive-authenticated', successListener, { once: true });
                window.addEventListener('google-drive-auth-failed', failureListener, { once: true });

                // Timeout for the authorization process
                 const timeoutId = setTimeout(() => {
                     cleanupListeners();
                     if (!this.isAuthorized) {
                         console.warn("Drive API: Authorization timed out.");
                         reject(new Error("Authorization timed out. Please try again."));
                     }
                 }, silent ? 15000 : 60000); // Shorter timeout for silent, longer for consent

                // Request the token
                console.log(`Drive API: Calling tokenClient.requestAccessToken with prompt: '${promptMode}'`);
                this.tokenClient.requestAccessToken({ prompt: promptMode });

            } catch (err) {
                console.error("Drive API: Error calling requestAccessToken:", err);
                this.isAuthorized = false;
                reject(err);
            }
        });
    }




    /**
     * Perform a Drive API request, ensuring authorization first.
     * Handles authorization prompts if needed.
     * @param {object} requestConfig - Config object for gapi.client.request or specific API method.
     * @returns {Promise<object>} The API response result (content of response.result).
     */
    async authorizedRequest(requestConfig) {
         console.log(`Drive API: Preparing authorized request for path: ${requestConfig.path}`);
         try {
             // Check if token is about to expire and refresh it proactively
             await this.checkAndRefreshToken();

             if (!this.isAuthorized) {
                console.log('Drive API: Not authorized for request, attempting authorization...');
                 // Try silent first, then prompt if needed.
                 await this.authorize(true).catch(async (silentError) => {
                     console.warn('Drive API: Silent authorization failed:', silentError.message, 'Prompting user...');
                     await this.authorize(false); // This will throw if it fails
                 });
             }

             // Double-check libraries are fully ready
             const loaded = await this.ensureLibrariesLoaded();

             // If the Drive API client is not available, try to initialize it again
             if (!gapi.client.drive) {
                 console.warn("Drive API: Drive client not ready, attempting to initialize it...");
                 try {
                     // Try direct initialization first
                     await gapi.client.load('drive', 'v3');
                     console.log('Drive API: Drive API loaded directly on demand.');
                 } catch (directLoadError) {
                     console.error("Drive API: Error loading Drive API directly on demand:", directLoadError);

                     // Fall back to manual initialization
                     console.log('Drive API: Attempting manual API initialization on demand...');
                     gapi.client.drive = {
                         files: {
                             list: (params) => gapi.client.request({
                                 path: 'https://www.googleapis.com/drive/v3/files',
                                 method: 'GET',
                                 params: params
                             }),
                             get: (params) => gapi.client.request({
                                 path: `https://www.googleapis.com/drive/v3/files/${params.fileId}`,
                                 method: 'GET',
                                 params: params
                             }),
                             create: (params) => gapi.client.request({
                                 path: 'https://www.googleapis.com/drive/v3/files',
                                 method: 'POST',
                                 params: params.params || {},
                                 body: params.body || {}
                             }),
                             delete: (params) => gapi.client.request({
                                 path: `https://www.googleapis.com/drive/v3/files/${params.fileId}`,
                                 method: 'DELETE'
                             }),
                             update: (params) => gapi.client.request({
                                 path: `https://www.googleapis.com/drive/v3/files/${params.fileId}`,
                                 method: 'PATCH',
                                 params: params.params || {},
                                 body: params.body || {}
                             })
                         },
                         permissions: {
                             create: (params) => gapi.client.request({
                                 path: `https://www.googleapis.com/drive/v3/files/${params.fileId}/permissions`,
                                 method: 'POST',
                                 body: params.resource || {}
                             })
                         }
                     };
                 }
             }

             // Final check if Drive API is available
             if (!loaded || !gapi.client.drive) {
                 throw new Error("Drive API client or discovery doc not ready after initialization attempts.");
             }

             console.log('Drive API: Making authorized request:', requestConfig.method || 'GET', requestConfig.path);
             const response = await gapi.client.request(requestConfig);
             console.log(`Drive API: Request successful for ${requestConfig.path}`);
             return response.result;

         } catch (error) {
              console.error('Drive API: Request failed:', requestConfig.path, error);
              const status = error.status || (error.result && error.result.error && error.result.error.code);

              if (status === 401 || status === 403) {
                   console.warn('Drive API: Authorization error (401/403) during request. Clearing auth state.');
                   // Try to refresh the token before giving up
                   try {
                       console.log('Drive API: Attempting to refresh token after 401/403 error...');
                       await this.refreshToken(true); // Force refresh

                       // If refresh succeeded, retry the request once
                       console.log('Drive API: Token refreshed successfully, retrying request...');
                       return this.authorizedRequest(requestConfig);
                   } catch (refreshError) {
                       console.error('Drive API: Token refresh failed after 401/403:', refreshError);
                       this.handleFirebaseSignOut(); // Clear token and local state
                       throw new Error('Authorization expired or insufficient permissions. Please sign in again or grant permissions.');
                   }
              } else if (error.message && error.message.includes("Drive authorization failed")) {
                  // If our explicit authorize call failed earlier and threw
                  throw error;
              }
              // Handle other potential errors (network, API specific errors)
              const errorMessage = (error.result && error.result.error && error.result.error.message) || error.message || 'An unknown Drive API error occurred.';
              throw new Error(`Drive API Error: ${errorMessage} (Status: ${status || 'N/A'})`);
         }
     }

    /**
     * Check if the current token is about to expire and refresh it if needed
     * @param {boolean} force - Force token refresh regardless of expiration
     * @returns {Promise<boolean>} - True if token is valid or was refreshed successfully
     */
    async checkAndRefreshToken() {
        // Only check if we're authorized and have libraries loaded
        if (!this.isAuthorized || !this.gapiLoaded || !this.gisLoaded) {
            return false;
        }

        try {
            const currentToken = gapi.client.getToken();
            if (!currentToken || !currentToken.access_token) {
                return false;
            }

            // Check if token will expire in the next 10 minutes
            const EXPIRY_BUFFER = 10 * 60 * 1000; // 10 minutes in milliseconds
            if (currentToken.expires_at && currentToken.expires_at <= (Date.now() + EXPIRY_BUFFER)) {
                console.log('Drive API: Token expiring soon, refreshing proactively...');
                return this.refreshToken();
            }

            // Token is still valid
            return true;
        } catch (error) {
            console.warn('Drive API: Error checking token expiration:', error);
            return false;
        }
    }

    /**
     * Refresh the access token
     * @param {boolean} force - Force token refresh regardless of expiration
     * @returns {Promise<boolean>} - True if token was refreshed successfully
     */
    async refreshToken(force = false) {
        if (!this.gapiLoaded || !this.gisLoaded || !this.tokenClient) {
            await this.ensureLibrariesLoaded();
        }

        try {
            const currentToken = gapi.client.getToken();
            const EXPIRY_BUFFER = 10 * 60 * 1000; // 10 minutes

            // Only refresh if token is expiring soon or force=true
            if (!force && currentToken && currentToken.expires_at &&
                currentToken.expires_at > (Date.now() + EXPIRY_BUFFER)) {
                console.log('Drive API: Token still valid, no refresh needed');
                return true;
            }

            console.log('Drive API: Refreshing token...');

            // Keep user email for hint
            const userEmail = localStorage.getItem('lastSignedInEmail');
            if (userEmail) {
                this.tokenClient.hint = userEmail;
            }

            // Set to silent mode
            this.tokenClient.prompt = '';

            // Request new token silently
            return new Promise((resolve, reject) => {
                // Set up listeners for token refresh
                const successListener = () => {
                    cleanup();
                    console.log('Drive API: Token refreshed successfully');
                    resolve(true);
                };

                const failureListener = (event) => {
                    cleanup();
                    console.error('Drive API: Token refresh failed:', event.detail);
                    reject(new Error('Token refresh failed'));
                };

                const cleanup = () => {
                    window.removeEventListener('google-drive-authenticated', successListener);
                    window.removeEventListener('google-drive-auth-failed', failureListener);
                    clearTimeout(timeoutId);
                };

                // Set timeout for refresh
                const timeoutId = setTimeout(() => {
                    cleanup();
                    console.warn('Drive API: Token refresh timed out');
                    reject(new Error('Token refresh timed out'));
                }, 15000); // 15 seconds timeout

                // Add event listeners
                window.addEventListener('google-drive-authenticated', successListener, { once: true });
                window.addEventListener('google-drive-auth-failed', failureListener, { once: true });

                // Request token
                this.tokenClient.requestAccessToken({ prompt: '' });
            });
        } catch (error) {
            console.error('Drive API: Error refreshing token:', error);
            return false;
        }
    }

    /**
     * Start periodic token refresh to maintain session
     * Refreshes token every 30 minutes to ensure it never expires
     */
    startPeriodicTokenRefresh() {
        // Clear any existing interval first
        this.stopPeriodicTokenRefresh();

        console.log('Drive API: Starting periodic token refresh');

        // Set up interval to refresh token every 30 minutes
        // This is well before the typical 1-hour expiration
        this.tokenRefreshInterval = setInterval(async () => {
            console.log('Drive API: Performing scheduled token refresh check');
            try {
                await this.checkAndRefreshToken();
            } catch (error) {
                console.warn('Drive API: Scheduled token refresh failed:', error);
                // Don't stop the interval - it will try again next time
            }
        }, 30 * 60 * 1000); // 30 minutes

        // Also add a page visibility listener to refresh when page becomes visible again
        // This helps with tabs that have been inactive for a while
        document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    }

    /**
     * Stop the periodic token refresh
     */
    stopPeriodicTokenRefresh() {
        if (this.tokenRefreshInterval) {
            console.log('Drive API: Stopping periodic token refresh');
            clearInterval(this.tokenRefreshInterval);
            this.tokenRefreshInterval = null;
        }

        // Remove visibility change listener
        document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    }

    /**
     * Handle page visibility changes
     * Refresh token when page becomes visible after being hidden
     */
    async handleVisibilityChange() {
        if (document.visibilityState === 'visible' && this.isAuthorized) {
            console.log('Drive API: Page became visible, checking token status');
            try {
                await this.checkAndRefreshToken();
            } catch (error) {
                console.warn('Drive API: Token refresh on visibility change failed:', error);
            }
        }
    }


     /**
 * Generate intelligent filename
 * @param {File} file - Original file
 * @param {Object} task - Task information
 * @returns {string} New filename
 */
generateIntelligentFilename(file, task) {
    const originalExt = file.name.split('.').pop().toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const parts = [];

    // Add task title if available
    if (task?.title) {
        parts.push(task.title.replace(/[^a-zA-Z0-9\s-]/g, '').trim());
    }

    // Add original filename without extension
    const originalNameWithoutExt = file.name.slice(0, -(originalExt.length + 1))
        .replace(/[^a-zA-Z0-9\s-]/g, '').trim();
    if (!parts.includes(originalNameWithoutExt)) {
        parts.push(originalNameWithoutExt);
    }

    // Add timestamp to ensure uniqueness
    parts.push(timestamp);

    // Combine parts and add extension
    return `${parts.join('_')}.${originalExt}`;
}

    /**
     * Upload a file to Google Drive (Uses authorizedRequest framework and XHR)
     */
    async uploadFile(file, taskId) {
        console.log(`Drive API: Starting uploadFile process for: ${file.name}, Task: ${taskId}`);
        try {
            await this.validateFile(file); // Local validation

            const task = await this.findTaskById(taskId);
            if (!task) throw new Error(`Task not found: ${taskId}`);

            const targetFolderId = await this.createFolderStructure( // Uses authorizedRequest internally
                task.projectName || 'Uncategorized',
                task.section || 'General'
            );

            const newFileName = this.generateIntelligentFilename(file, task);

            const metadata = {
                name: newFileName,
                mimeType: file.type || 'application/octet-stream', // Provide default mime type
                parents: [targetFolderId],
                appProperties: {
                    taskId: taskId,
                    taskTitle: task.title || '',
                    taskSection: task.section || '',
                    projectName: task.projectName || '',
                    appName: 'GPAce',
                    uploadDate: new Date().toISOString(),
                    originalName: file.name
                }
            };

            // Ensure authorized before getting token for XHR
            await this.authorize(true).catch(() => this.authorize(false));

            const token = gapi.client.getToken();
            if (!token || !token.access_token) {
                 throw new Error('Cannot upload: Not authorized or token unavailable.');
            }

            // Perform the actual upload using XHR
            const uploadResult = await this.directUploadFileWithToken(file, metadata, token.access_token);

            // Make file public and get full info AFTER successful upload
            try {
                await this.makeFilePublic(uploadResult.id); // Uses authorizedRequest
                const finalFileInfo = await this.getFileInfo(uploadResult.id); // Uses authorizedRequest
                console.log('Drive API: File uploaded and made public:', finalFileInfo.name);

                 window.dispatchEvent(new CustomEvent('file-upload-success', { detail: { file: finalFileInfo, task: task } }));
                return finalFileInfo;

            } catch (permError) {
                 console.error("Drive API: Error making file public or getting final info:", permError);
                 // Return basic info even if post-upload steps fail
                 window.dispatchEvent(new CustomEvent('file-upload-success', { detail: { file: uploadResult, task: task } }));
                 return uploadResult;
            }

        } catch (error) {
            console.error('Drive API: Error in uploadFile process:', error);
             window.dispatchEvent(new CustomEvent('file-upload-error', { detail: { error: error.message || error } }));
            throw error; // Re-throw to be caught by caller
        }
    }

     /** HELPER: Direct upload using XHR and provided token */
     directUploadFileWithToken(file, metadata, accessToken) {
          console.log(`Drive API: Starting direct upload for ${file.name}...`);
          return new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,appProperties'; // Get appProperties back too
              xhr.open('POST', uploadUrl);
              xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
              xhr.responseType = 'json';

              let lastProgressUpdate = 0;
              xhr.upload.onprogress = (event) => {
                   if (event.lengthComputable) {
                        const now = Date.now();
                        // Throttle progress updates slightly to avoid overwhelming the main thread
                        if (now - lastProgressUpdate > 100) {
                             const percentComplete = Math.round((event.loaded / event.total) * 100);
                             window.dispatchEvent(new CustomEvent('file-upload-progress', { detail: { fileName: file.name, loaded: event.loaded, total: event.total, percent: percentComplete } }));
                             lastProgressUpdate = now;
                        }
                   }
              };

              xhr.onload = function() {
                  // Ensure final progress event fires
                   window.dispatchEvent(new CustomEvent('file-upload-progress', { detail: { fileName: file.name, loaded: file.size, total: file.size, percent: 100, completed: true } }));

                  if (this.status === 200 && this.response && this.response.id) {
                      console.log('Drive API: Direct upload successful (XHR). File ID:', this.response.id);
                      resolve(this.response); // Resolve with {id, name, mimeType, appProperties}
                  } else {
                      const errorMsg = (this.response?.error?.message || this.statusText || `HTTP status ${this.status}`);
                      console.error('Drive API: Direct upload failed (XHR):', errorMsg, this.response);
                      window.dispatchEvent(new CustomEvent('file-upload-error', { detail: { error: `Upload failed: ${errorMsg}` } }));
                      reject(new Error(`Upload failed: ${errorMsg}`));
                  }
              };
              xhr.onerror = function(err) {
                   console.error('Drive API: Network error during direct upload:', err);
                    window.dispatchEvent(new CustomEvent('file-upload-progress', { detail: { fileName: file.name, loaded: 0, total: file.size, percent: 0, completed: true, error: true } }));
                    window.dispatchEvent(new CustomEvent('file-upload-error', { detail: { error: 'Network error during upload' } }));
                    reject(new Error('Network error during upload'));
              };

              const formData = new FormData();
              formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json; charset=UTF-8' }));
              formData.append('file', file);

              console.log(`Drive API: Sending XHR for ${file.name}...`);
              xhr.send(formData);
          });
     }

    /** HELPER: Make file readable by anyone */
    async makeFilePublic(fileId) {
         console.log(`Drive API: Making file ${fileId} public...`);
         return this.authorizedRequest({
             path: `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
             method: 'POST',
             headers: { 'Content-Type': 'application/json' }, // Important for POST body
             body: JSON.stringify({ // Stringify the body
                 role: 'reader',
                 type: 'anyone'
             })
         });
     }

    /** HELPER: Get file info including web links */
    async getFileInfo(fileId) {
        console.log(`Drive API: Getting info for file ${fileId}...`);
        return this.authorizedRequest({
            path: `https://www.googleapis.com/drive/v3/files/${fileId}`,
            method: 'GET',
            params: { fields: 'id, name, mimeType, webViewLink, webContentLink, thumbnailLink, createdTime, appProperties, size, iconLink' } // Added size and iconLink
        });
    }

    /**
     * Get or create a specific folder within a parent folder.
     */
    async getOrCreateFolderStructure(parentFolderId, folderName) {
        console.log(`Drive API: Ensuring folder '${folderName}' exists in parent '${parentFolderId}'...`);
        try {
             // Escape single quotes in folder name for the query
             const cleanFolderName = folderName.replace(/'/g, "\\'");
             const query = `mimeType='application/vnd.google-apps.folder' and name='${cleanFolderName}' and '${parentFolderId}' in parents and trashed=false`;

             const listResult = await this.authorizedRequest({
                 path: 'https://www.googleapis.com/drive/v3/files',
                 method: 'GET',
                 params: { q: query, fields: 'files(id)', corpora: 'user' } // corpora: 'user' might help if searching own drive
             });

             if (listResult.files && listResult.files.length > 0) {
                 console.log(`Drive API: Folder '${folderName}' found with ID: ${listResult.files[0].id}`);
                 return listResult.files[0].id; // Folder exists
             } else {
                 // Create folder
                 console.log(`Drive API: Folder '${folderName}' not found, creating...`);
                 const createResult = await this.authorizedRequest({
                     path: 'https://www.googleapis.com/drive/v3/files',
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ // Stringify body
                         name: folderName, // Use original name for creation
                         mimeType: 'application/vnd.google-apps.folder',
                         parents: [parentFolderId]
                     }),
                     params: { fields: 'id' }
                 });
                 console.log(`Drive API: Folder '${folderName}' created with ID: ${createResult.id}`);
                 return createResult.id;
             }
         } catch (error) {
             console.error(`Drive API: Error getting/creating folder '${folderName}':`, error);
             throw error; // Re-throw
         }
     }

     /** Get or create the main application folder */
     async getOrCreateAppFolder() {
          return this.getOrCreateFolderStructure('root', 'GPAce Task Files'); // 'root' alias for user's root Drive folder
     }

     /** Create nested structure for Project/Section */
     async createFolderStructure(projectName, section) {
          const rootFolderId = await this.getOrCreateAppFolder();
          // Basic cleaning, allow spaces and hyphens
          const cleanProjectName = projectName.replace(/[^\w\s-]/g, '').trim() || 'Uncategorized Project';
          const cleanSection = section.replace(/[^\w\s-]/g, '').trim() || 'General Section';

          const projectFolderId = await this.getOrCreateFolderStructure(rootFolderId, cleanProjectName);
          const sectionFolderId = await this.getOrCreateFolderStructure(projectFolderId, cleanSection);
          return sectionFolderId;
      }


    /** Get files associated with a specific task */
    async getTaskFiles(taskId) {
        console.log(`Drive API: Getting files for task ${taskId}...`);
        const result = await this.authorizedRequest({
            path: 'https://www.googleapis.com/drive/v3/files',
            method: 'GET',
            params: {
                q: `appProperties has { key='taskId' and value='${taskId}' } and trashed=false`,
                fields: 'files(id, name, mimeType, webViewLink, webContentLink, thumbnailLink, createdTime, appProperties, size, iconLink)', // Added size, iconLink
                orderBy: 'createdTime desc' // Order by creation time
            }
        });
        console.log(`Drive API: Found ${result.files ? result.files.length : 0} files for task ${taskId}.`);
        return result.files || [];
    }

    /** Delete a file from Google Drive */
    async deleteFile(fileId) {
         console.log(`Drive API: Deleting file ${fileId}...`);
         // GAPI expects no body for DELETE, so send empty string or null
         await this.authorizedRequest({
             path: `https://www.googleapis.com/drive/v3/files/${fileId}`,
             method: 'DELETE',
             body: null // Explicitly null body
         });
         console.log(`Drive API: File ${fileId} deleted successfully.`);
         return true; // Indicate success
     }

    // --- Keep Preview Dialog Logic As Is (initializePreviewDialog, closePreview) ---
    initializePreviewDialog() {
        // Create dialog only if it doesn't exist
        if (document.querySelector('.file-preview-dialog')) {
            this.previewDialog = document.querySelector('.file-preview-dialog');
            return;
        }
        const dialog = document.createElement('div');
        dialog.className = 'file-preview-dialog';
        dialog.style.display = 'none'; // Initially hidden
        // Using Bootstrap modal structure for better styling/consistency if Bootstrap is available
        dialog.innerHTML = `
            <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content" style="height: 90vh; background-color: var(--card-bg, #2a2a2a); color: var(--text-color, #fff);">
                    <div class="modal-header" style="border-bottom: 1px solid var(--border-color, #444);">
                        <h5 class="modal-title file-name text-truncate">File Preview</h5>
                        <button type="button" class="btn-close btn-close-white close-button" aria-label="Close"></button>
                    </div>
                    <div class="modal-body file-preview-body d-flex justify-content-center align-items-center" style="background-color: var(--modal-body-bg, #333);">
                        <div class="spinner-border text-primary" role="status">
                           <span class="visually-hidden">Loading...</span>
                        </div>
                        <div class="preview-container w-100 h-100" style="display: none;"></div>
                    </div>
                     <div class="modal-footer justify-content-center" style="border-top: 1px solid var(--border-color, #444);">
                        <a href="#" target="_blank" class="btn btn-outline-light btn-sm open-link" rel="noopener noreferrer">
                            <i class="bi bi-box-arrow-up-right"></i> Open in Google Drive
                        </a>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
        this.previewDialog = dialog;

        // Add close handlers
        dialog.querySelector('.close-button').addEventListener('click', () => this.closePreview());
        dialog.addEventListener('click', (e) => {
            // Close if backdrop is clicked (the outer dialog element)
            if (e.target === dialog) {
                this.closePreview();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.previewDialog.style.display === 'block') {
                this.closePreview();
            }
        });
    }

    async showPreview(fileId) {
        console.log(`Drive API: Showing preview for file ${fileId}`);
        if (!this.previewDialog) this.initializePreviewDialog();

        const modalTitle = this.previewDialog.querySelector('.file-name');
        const previewBody = this.previewDialog.querySelector('.file-preview-body');
        const previewContainer = this.previewDialog.querySelector('.preview-container');
        const loadingSpinner = previewBody.querySelector('.spinner-border');
        const openLink = this.previewDialog.querySelector('.open-link');

        // Reset state
        modalTitle.textContent = 'Loading...';
        previewContainer.innerHTML = '';
        previewContainer.style.display = 'none';
        loadingSpinner.style.display = 'block';
        openLink.href = '#'; // Reset link
        this.previewDialog.style.display = 'block'; // Show modal backdrop and structure

        try {
            const file = await this.getFileInfo(fileId); // Fetch fresh info
            console.log(`Drive API: Previewing file: ${file.name}, Type: ${file.mimeType}`);

            modalTitle.textContent = file.name;
            openLink.href = file.webViewLink || '#';

            // Render preview based on type
            previewContainer.innerHTML = ''; // Clear any previous content
            if (file.mimeType?.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = file.webContentLink || file.thumbnailLink; // Use webContentLink if available
                img.alt = file.name;
                img.style.maxWidth = '100%';
                img.style.maxHeight = '100%';
                img.style.objectFit = 'contain';
                img.onerror = () => previewContainer.innerHTML = '<div class="alert alert-warning">Could not load image preview.</div>';
                previewContainer.appendChild(img);
            } else if (file.mimeType === 'application/pdf' || file.mimeType?.includes('presentation') || file.mimeType?.includes('spreadsheet') || file.mimeType?.includes('document')) {
                 // Use Google Drive's embedded viewer via webViewLink
                const iframe = document.createElement('iframe');
                // Add '/preview' or '/embed' for a cleaner view if possible, test this
                iframe.src = file.webViewLink.replace('/edit', '/preview'); // Try preview mode
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.border = 'none';
                iframe.onload = () => console.log("iframe loaded");
                iframe.onerror = () => previewContainer.innerHTML = '<div class="alert alert-warning">Could not load document preview. Try opening in Google Drive.</div>';
                previewContainer.appendChild(iframe);
            }
             else {
                // Fallback for other types
                previewContainer.innerHTML = `
                    <div class="text-center p-4">
                        <i class="bi bi-file-earmark" style="font-size: 4rem; color: #ccc;"></i>
                        <p class="mt-3">Preview not available for this file type (${file.mimeType || 'unknown'}).</p>
                        <a href="${file.webViewLink}" target="_blank" class="btn btn-primary btn-sm" rel="noopener noreferrer">
                            Open File
                        </a>
                    </div>`;
            }

            loadingSpinner.style.display = 'none';
            previewContainer.style.display = 'block';

        } catch (error) {
            console.error('Drive API: Error showing preview:', error);
            loadingSpinner.style.display = 'none';
            previewContainer.style.display = 'block'; // Show container for error message
            previewContainer.innerHTML = `<div class='alert alert-danger m-3'>Error loading preview: ${error.message}. Please try opening in Google Drive.</div>`;
            modalTitle.textContent = 'Error';
        }
    }

    closePreview() {
        if (this.previewDialog) {
            this.previewDialog.style.display = 'none';
            const previewContainer = this.previewDialog.querySelector('.preview-container');
            if (previewContainer) previewContainer.innerHTML = ''; // Clear content
        }
    }

    // --- Keep findTaskById As Is ---
     async findTaskById(taskId) {
        if (!taskId) return null;
        // 1. Try priority list
        try {
            const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
            const task = priorityTasks.find(t => t.id === taskId);
            if (task) return task;
        } catch (e) { console.error("Error reading priority tasks:", e); }

        // 2. Try project lists (subjects)
        try {
            const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
            for (const subject of subjects) {
                const projectId = subject.tag;
                const tasksKey = `tasks-${projectId}`;
                // Prioritize Firestore if available
                let projectTasks = [];
                if (typeof window.loadTasksFromFirestore === 'function') {
                    try {
                        projectTasks = await window.loadTasksFromFirestore(projectId) || [];
                    } catch (fsError) {
                         console.warn(`Firestore load failed for ${projectId}, falling back to localStorage.`, fsError);
                         projectTasks = JSON.parse(localStorage.getItem(tasksKey) || '[]');
                    }
                } else {
                     projectTasks = JSON.parse(localStorage.getItem(tasksKey) || '[]');
                }

                const task = projectTasks.find(t => t.id === taskId);
                if (task) {
                    // Enrich with project info if missing
                    if (!task.projectId) task.projectId = projectId;
                    if (!task.projectName) task.projectName = subject.name;
                    return task;
                }
            }
        } catch (e) { console.error("Error reading project tasks:", e); }

        // 3. Try DOM (less reliable) - Look for the main task container
         try {
            const taskElement = document.querySelector(`.priority-task-box [data-task-id="${taskId}"]`);
            if (taskElement) {
                 const title = taskElement.querySelector('.task-title')?.textContent.trim();
                 const details = taskElement.querySelector('.task-details')?.textContent.trim();
                 const section = details?.split('•')[0]?.trim();
                 const projectName = details?.split('•')[1]?.trim();
                 const projectId = taskElement.dataset.projectId;
                 if (title && projectId) {
                      return { id: taskId, title, section: section || 'Unknown', projectId, projectName: projectName || projectId };
                 }
            }
         } catch(e){ console.error("Error reading task from DOM:", e);}

        console.warn(`Task with ID ${taskId} not found in any known source.`);
        return null;
    }


    // --- Subject Material Functions (using authorizedRequest framework) ---
     async getOrCreateSubjectFolder(subjectTag) {
         const rootFolderId = await this.getOrCreateAppFolder(); // Ensure root app folder exists
         const subjectFolderName = `${subjectTag}_Materials`;
         return this.getOrCreateFolderStructure(rootFolderId, subjectFolderName); // Use helper
     }

    async uploadSubjectFile(file, subjectTag, materialType = 'general') {
         console.log(`Drive API: Starting subject file upload: ${file.name}, Subject: ${subjectTag}, Type: ${materialType}`);
        try {
            await this.validateFile(file);

            const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
            const subject = subjects.find(s => s.tag === subjectTag);
            if (!subject) throw new Error(`Subject not found: ${subjectTag}`);

            const targetFolderId = await this.getOrCreateSubjectFolder(subjectTag);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            // Clean filename more aggressively
            const safeOriginalName = file.name.replace(/[^\w\s.-]/g, '_').replace(/\s+/g, '_');
            const newFileName = `${subject.name}_${materialType}_${safeOriginalName}`.substring(0, 200); // Limit length

            const metadata = {
                name: newFileName,
                mimeType: file.type || 'application/octet-stream',
                parents: [targetFolderId],
                appProperties: {
                    subjectTag: subjectTag,
                    subjectName: subject.name,
                    materialType: materialType,
                    appName: 'GPAce',
                    uploadDate: timestamp, // Use ISOString timestamp
                    originalName: file.name
                }
            };

            // Ensure authorized before getting token
            await this.authorize(true).catch(() => this.authorize(false));
            const token = gapi.client.getToken();
            if (!token || !token.access_token) throw new Error('Not authorized.');

            // Use XHR uploader
            const uploadResult = await this.directUploadFileWithToken(file, metadata, token.access_token);

             // Make public and get full info
            try {
                 await this.makeFilePublic(uploadResult.id);
                 const finalFileInfo = await this.getFileInfo(uploadResult.id);
                 console.log('Drive API: Subject file uploaded:', finalFileInfo.name);

                 this.updateSubjectMaterialsCache(subjectTag, finalFileInfo); // Update cache

                  window.dispatchEvent(new CustomEvent('subject-file-upload-success', { detail: { file: finalFileInfo, subject: subject, materialType: materialType } }));
                 return finalFileInfo;

            } catch (permError) {
                 console.error("Drive API: Error making subject file public:", permError);
                 this.updateSubjectMaterialsCache(subjectTag, uploadResult); // Cache basic info
                  window.dispatchEvent(new CustomEvent('subject-file-upload-success', { detail: { file: uploadResult, subject: subject, materialType: materialType } }));
                 return uploadResult;
            }

        } catch (error) {
            console.error('Drive API: Error uploading subject file:', error);
            window.dispatchEvent(new CustomEvent('subject-file-upload-error', { detail: { error: error.message || error } }));
            throw error;
        }
    }

     updateSubjectMaterialsCache(subjectTag, fileInfo) {
         try {
             const cacheKey = 'subjectMaterials';
             const subjectMaterialsJson = localStorage.getItem(cacheKey) || '{}';
             const subjectMaterials = JSON.parse(subjectMaterialsJson);
             if (!subjectMaterials[subjectTag]) {
                 subjectMaterials[subjectTag] = [];
             }
             // Remove existing entry if it exists (by fileId)
             subjectMaterials[subjectTag] = subjectMaterials[subjectTag].filter(m => m.fileId !== fileInfo.id);

             // Add the new/updated file info
             const newEntry = {
                 fileId: fileInfo.id,
                 fileName: fileInfo.name,
                 materialType: fileInfo.appProperties?.materialType || 'general',
                 uploadDate: fileInfo.appProperties?.uploadDate || fileInfo.createdTime || new Date().toISOString(),
                 webViewLink: fileInfo.webViewLink,
                 webContentLink: fileInfo.webContentLink,
                 mimeType: fileInfo.mimeType,
                 size: fileInfo.size,
                 iconLink: fileInfo.iconLink
             };
             subjectMaterials[subjectTag].push(newEntry);

             // Sort materials perhaps? (e.g., by name or date)
             subjectMaterials[subjectTag].sort((a, b) => a.fileName.localeCompare(b.fileName));

             localStorage.setItem(cacheKey, JSON.stringify(subjectMaterials));
             console.log(`Drive API: Subject materials cache updated for ${subjectTag}`);
         } catch (e) {
             console.error("Drive API: Failed to update subject materials cache:", e);
         }
     }

    async getSubjectFiles(subjectTag) {
        console.log(`Drive API: Getting files for subject ${subjectTag}...`);

        // First check if we need to initialize the API
        if (!gapi.client.drive) {
            console.warn('Drive API: Drive client not available, attempting to initialize...');
            const initialized = await this.initialize();
            if (!initialized) {
                console.error('Drive API: Failed to initialize Drive API for getSubjectFiles');
                throw new Error('Google Drive API could not be initialized. Please refresh the page and try again.');
            }
        }

        try {
            // Try to get files from the API
            const result = await this.authorizedRequest({
                path: 'https://www.googleapis.com/drive/v3/files',
                method: 'GET',
                params: {
                    q: `appProperties has { key='subjectTag' and value='${subjectTag}' } and trashed=false`,
                    fields: 'files(id, name, mimeType, webViewLink, webContentLink, thumbnailLink, createdTime, appProperties, size, iconLink)',
                    orderBy: 'name' // Order by name for consistency
                }
            });

            console.log(`Drive API: Found ${result.files ? result.files.length : 0} files for subject ${subjectTag}.`);
            return result.files || [];
        } catch (error) {
            console.error(`Drive API: Error getting files for subject ${subjectTag}:`, error);

            // Check if we have cached files in localStorage
            try {
                const cacheKey = 'subjectMaterials';
                const subjectMaterialsJson = localStorage.getItem(cacheKey) || '{}';
                const subjectMaterials = JSON.parse(subjectMaterialsJson);

                if (subjectMaterials[subjectTag] && subjectMaterials[subjectTag].length > 0) {
                    console.log(`Drive API: Using ${subjectMaterials[subjectTag].length} cached files for subject ${subjectTag}`);

                    // Convert cached format to API format
                    return subjectMaterials[subjectTag].map(cachedFile => ({
                        id: cachedFile.fileId,
                        name: cachedFile.fileName,
                        mimeType: cachedFile.mimeType,
                        webViewLink: cachedFile.webViewLink,
                        webContentLink: cachedFile.webContentLink,
                        createdTime: cachedFile.uploadDate,
                        appProperties: {
                            materialType: cachedFile.materialType,
                            subjectTag: subjectTag
                        },
                        size: cachedFile.size,
                        iconLink: cachedFile.iconLink
                    }));
                }
            } catch (cacheError) {
                console.error('Drive API: Error reading from cache:', cacheError);
            }

            // If we get here, both API and cache failed
            throw error;
        }
    }

    /** Validate file based on size and type */
    async validateFile(file) {
        if (!file) {
             throw new Error("No file provided for validation.");
        }
        // Check size
        if (file.size > this.maxFileSize) {
            const maxSizeMB = (this.maxFileSize / (1024 * 1024)).toFixed(1);
            throw new Error(`File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum size is ${maxSizeMB}MB.`);
        }
        // Check type
        const fileType = file.type || 'application/octet-stream'; // Use default if type is empty
        if (!this.allowedFileTypes.includes(fileType) && !this.allowedFileTypes.some(allowed => fileType.startsWith(allowed.replace('*','')))) {
             // Basic wildcard check e.g. for 'image/*'
             // More robust check might be needed depending on allowed types list
             console.warn(`File type '${fileType}' not in allowed list:`, this.allowedFileTypes);
             // Decide whether to throw an error or allow it
             // throw new Error(`File type '${fileType}' is not allowed.`);
        }
        // Check concurrent uploads (basic check)
        if (this.activeUploads >= this.maxConcurrentUploads) {
            // This is a simple counter, might need more robust queue management
            console.warn("Maximum concurrent uploads reached. Waiting might be needed.");
            // throw new Error('Maximum concurrent uploads reached. Please wait.');
        }
        return true; // Validation passed
    }

} // End of class GoogleDriveAPI

// Create and export singleton instance
const googleDriveAPI = new GoogleDriveAPI();

// Make it globally accessible FOR auth.js callbacks AND taskAttachments.js import
window.googleDriveAPI = googleDriveAPI;

export default googleDriveAPI;