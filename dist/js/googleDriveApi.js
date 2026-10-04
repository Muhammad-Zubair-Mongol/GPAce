
// Helper function to abstract storage access
function getStorage() {
    if (window.StorageService) {
        return window.StorageService;
    }
    // Fallback if StorageService is not yet available (e.g. during early init)
    return {
        get: (key, defaultValue) => {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                console.warn(`Error parsing ${key} from localStorage`, e);
                return defaultValue;
            }
        },
        set: (key, value) => {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.error(`Error saving ${key} to localStorage`, e);
            }
        },
        remove: (key) => {
            localStorage.removeItem(key);
        }
    };
}

class GoogleDriveAPI {
    constructor() {
        // Configuration
        this.DISCOVERY_DOCS = [
            'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
        ];
        this.SCOPES = [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.install'
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

        // Readiness flag for dependent modules
        this.isInitialized = false;

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
     * Initialize the Google Drive API.
     * Ensures libraries are loaded and client is initialized.
     */
    async initialize() {
        if (this.isAuthorized) return true;
        if (this._initializationPromise) return this._initializationPromise;

        this._initializationPromise = (async () => {
            try {
                console.log('Drive API: Initializing...');
                const loaded = await this.ensureLibrariesLoaded();
                if (loaded) {
                    console.log('Drive API: Libraries loaded. Checking auth status...');
                    // Attempt silent authorization if we have a token
                    const authorized = await this.authorize(true);
                    if (authorized) {
                        console.log('Drive API: Automatically authorized.');
                    }
                    return true;
                }
                return false;
            } catch (error) {
                console.error('Drive API: Initialization failed:', error);
                return false;
            } finally {
                this._initializationPromise = null;
            }
        })();

        return this._initializationPromise;
    }

    /**
     * Load Google Identity Services and GAPI scripts.
     */
    async ensureLibrariesLoaded() {
        if (this.gapiLoaded && this.gisLoaded) return true;

        return new Promise((resolve) => {
            const checkLibraries = () => {
                if (window.gapi && window.google && window.google.accounts && window.google.accounts.oauth2) {
                    this.gapiLoaded = true;
                    this.gisLoaded = true;
                    this.initializeGapiClient().then(resolve);
                } else {
                    setTimeout(checkLibraries, 100);
                }
            };
            checkLibraries();
        });
    }

    /**
     * Initialize the GAPI client with API Key and Discovery Docs.
     */
    async initializeGapiClient() {
        // Initialize Token Client FIRST so auth can work even if GAPI fails
        try {
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: this.CLIENT_ID,
                scope: this.SCOPES.join(' '),
                callback: (tokenResponse) => {
                    if (tokenResponse && tokenResponse.access_token) {
                        this.isAuthorized = true;
                        console.log('Drive API: Token received and authorized.');

                        // Store token details for persistence/refresh
                        const storage = getStorage();
                        const tokenData = {
                            access_token: tokenResponse.access_token,
                            expires_in: tokenResponse.expires_in,
                            timestamp: Date.now()
                        };
                        storage.set('gdriveToken', tokenData);

                        window.dispatchEvent(new CustomEvent('google-drive-authenticated'));
                    } else {
                        this.isAuthorized = false;
                        console.warn('Drive API: Token request failed or denied.');
                        window.dispatchEvent(new CustomEvent('google-drive-auth-failed', { detail: tokenResponse }));
                    }
                },
            });
            console.log('Drive API: Token Client initialized.');
        } catch (tokenError) {
            console.error('Drive API: Failed to initialize Token Client:', tokenError);
        }

        // Initialize GAPI Client
        try {
            await new Promise((resolve, reject) => {
                gapi.load('client', {
                    callback: resolve,
                    onerror: reject,
                    timeout: 5000,
                    ontimeout: reject
                });
            });

            // Try to initialize GAPI client
            // Note: failing here (e.g. 502 on discovery) should NOT block the app
            try {
                await gapi.client.init({
                    // apiKey: this.API_KEY, // Omit API Key to see if it fixes 502/Bad Gateway on discovery
                    discoveryDocs: this.DISCOVERY_DOCS,
                });
                console.log('Drive API: GAPI client initialized with discovery docs.');
            } catch (initError) {
                console.warn('Drive API: GAPI client init failed (likely discovery doc error). Drive operations might fail until fixed.', initError);
                // Try fallback loading without discovery if init failed
                try {
                    console.log('Drive API: Attempting fallback load of Drive API v3...');
                    await gapi.client.load('drive', 'v3');
                    console.log('Drive API: Fallback load successful.');
                } catch (fallbackError) {
                    console.error('Drive API: Fallback load also failed:', fallbackError);
                }
            }

            // Check for existing valid token
            const storage = getStorage();
            const storedToken = storage.get('gdriveToken', null);
            if (storedToken) {
                const now = Date.now();
                const elapsed = (now - storedToken.timestamp) / 1000;
                if (elapsed < storedToken.expires_in) {
                    console.log('Drive API: Found valid stored token.');
                    gapi.client.setToken({ access_token: storedToken.access_token });
                    this.isAuthorized = true;
                    window.dispatchEvent(new CustomEvent('google-drive-authenticated'));
                } else {
                    console.log('Drive API: Stored token expired.');
                    storage.remove('gdriveToken');
                }
            }

        } catch (gapiError) {
            console.error('Drive API: Critical GAPI load error:', gapiError);
        }

        // Mark as initialized and dispatch event for dependent modules
        // We mark true even if GAPI failed partially, so the UI buttons become active (Sign In might still work)
        this.isInitialized = true;
        window.dispatchEvent(new CustomEvent('google-drive-initialized'));
        console.log('Drive API: Client initialized and ready (Token Client ready).');

        return true;
    }

    /**
     * Check if user is currently authorized for Drive API access.
     * This method checks the stored token and attempts silent reauthorization if needed.
     * @returns {Promise<boolean>} True if authorized, false otherwise.
     */
    async checkAuthStatus() {
        // If already authorized, return true
        if (this.isAuthorized) {
            console.log('Drive API: Already authorized');
            return true;
        }

        // Check for stored token
        const storage = getStorage();
        const storedToken = storage.get('gdriveToken', null);

        if (storedToken) {
            const now = Date.now();
            const elapsed = (now - storedToken.timestamp) / 1000;

            // Token still valid (with 5 minute buffer)
            if (elapsed < (storedToken.expires_in - 300)) {
                console.log('Drive API: Valid stored token found, restoring...');
                try {
                    // Ensure libraries are loaded first
                    await this.ensureLibrariesLoaded();
                    gapi.client.setToken({ access_token: storedToken.access_token });
                    this.isAuthorized = true;
                    window.dispatchEvent(new CustomEvent('google-drive-authenticated'));
                    return true;
                } catch (error) {
                    console.warn('Drive API: Error restoring token:', error);
                }
            } else {
                console.log('Drive API: Stored token expired, removing...');
                storage.remove('gdriveToken');
            }
        }

        // No valid stored token, not authorized
        console.log('Drive API: Not authorized (no valid stored token)');
        return false;
    }

    /**
     * Handle Firebase Sign Out - Clear Drive Token
     */
    handleFirebaseSignOut() {
        if (this.isAuthorized) {
            const token = gapi.client.getToken();
            if (token !== null) {
                google.accounts.oauth2.revoke(token.access_token, () => {
                    console.log('Drive API: Token revoked on sign-out.');
                    gapi.client.setToken('');
                    const storage = getStorage();
                    storage.remove('gdriveToken');
                    this.isAuthorized = false;
                    console.log('Drive API: Authorization status set to false.');
                    window.dispatchEvent(new CustomEvent('google-drive-signed-out'));
                });
            } else {
                // Even if gapi token is null, ensure we clear our local state
                gapi.client.setToken('');
                const storage = getStorage();
                storage.remove('gdriveToken');
                this.isAuthorized = false;
                console.log('Drive API: Authorization status set to false.');
                window.dispatchEvent(new CustomEvent('google-drive-signed-out'));
            }
        }
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
                console.log('Drive API: Existing token is valid.');
                return true;
            }
        }

        // Check if we have a stored token that is still valid
        const storage = getStorage();
        const storedToken = storage.get('gdriveToken', null);
        if (storedToken && silent) {
            const now = Date.now();
            const elapsed = (now - storedToken.timestamp) / 1000;
            if (elapsed < storedToken.expires_in - 300) { // 5 min buffer
                console.log('Drive API: Restoring valid stored token.');
                gapi.client.setToken({ access_token: storedToken.access_token });
                this.isAuthorized = true;
                return true;
            }
        }

        // If silent and we have a hint (e.g. email), try to use it
        if (silent) {
            const lastEmail = storage.get('lastSignedInEmail');
            if (lastEmail) {
                this.tokenClient.requestAccessToken({ prompt: '', hint: lastEmail });
            } else {
                this.tokenClient.requestAccessToken({ prompt: '' });
            }
        } else {
            // Interactive login
            this.tokenClient.requestAccessToken({ prompt: 'consent' });
        }

        // Wait for the callback (handled in initializeGapiClient)
        return new Promise((resolve) => {
            const successHandler = () => {
                window.removeEventListener('google-drive-authenticated', successHandler);
                window.removeEventListener('google-drive-auth-failed', failHandler);
                resolve(true);
            };
            const failHandler = () => {
                window.removeEventListener('google-drive-authenticated', successHandler);
                window.removeEventListener('google-drive-auth-failed', failHandler);
                // If silent failed, we might want to clean up
                if (silent) {
                    storage.remove('gdriveToken');
                }
                resolve(false);
            };
            window.addEventListener('google-drive-authenticated', successHandler);
            window.addEventListener('google-drive-auth-failed', failHandler);
        });
    }

    /**
     * Check if token is valid and refresh if needed
     */
    async checkAndRefreshToken() {
        if (!this.isAuthorized) return;

        const token = gapi.client.getToken();
        if (!token) return;

        // If we don't have expiration info in the token object, we rely on our stored timestamp
        // But gapi.client.getToken() usually returns what we set.
        // Let's rely on our stored token data for expiration check
        const storage = getStorage();
        const storedToken = storage.get('gdriveToken', null);

        if (storedToken) {
            const now = Date.now();
            const elapsed = (now - storedToken.timestamp) / 1000;
            const remaining = storedToken.expires_in - elapsed;

            // Refresh if less than 10 minutes remaining
            if (remaining < 600) {
                console.log('Drive API: Token expiring soon, refreshing...');
                await this.refreshToken();
            }
        }
    }

    /**
     * Explicitly refresh the token
     */
    async refreshToken() {
        console.log('Drive API: Refreshing token...');
        const storage = getStorage();
        const lastEmail = storage.get('lastSignedInEmail');

        if (lastEmail) {
            this.tokenClient.requestAccessToken({ prompt: '', hint: lastEmail });
        } else {
            this.tokenClient.requestAccessToken({ prompt: '' });
        }

        return new Promise((resolve, reject) => {
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
        });
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
     * Wrapper for gapi.client.request that handles authorization checks
     */
    async authorizedRequest(requestOptions) {
        if (!this.isAuthorized) {
            console.log('Drive API: Request requires authorization. Attempting silent auth...');
            const authorized = await this.authorize(true); // Try silent first
            if (!authorized) {
                // FALLBACK: Interactive Auth
                console.log('Drive API: Silent auth failed. Triggering interactive consent...');
                try {
                    const interactiveAuth = await this.authorize(false);
                    if (!interactiveAuth) {
                        throw new Error("User denied authorization.");
                    }
                } catch (e) {
                    throw new Error("User not authorized. Please sign in to Google Drive.");
                }
            }
        }

        try {
            const response = await gapi.client.request(requestOptions);
            return response.result;
        } catch (error) {
            // If error is 401 (Unauthorized), try to refresh token and retry ONCE
            if (error.status === 401 || error.status === 403) {
                console.warn(`Drive API: ${error.status} Error. Attempting token refresh/re-auth...`);
                try {
                    await this.refreshToken();
                    // Retry request
                    const retryResponse = await gapi.client.request(requestOptions);
                    return retryResponse.result;
                } catch (refreshError) {
                    console.error('Drive API: Token refresh failed after error:', refreshError);
                    // Last Resort: Interactive
                    try {
                        await this.authorize(false);
                        const finalResponse = await gapi.client.request(requestOptions);
                        return finalResponse.result;
                    } catch (finalError) {
                        throw error; // Give up
                    }
                }
            }
            throw error;
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

            xhr.onload = function () {
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
            xhr.onerror = function (err) {
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
            const storage = getStorage();
            const priorityTasks = storage.get('calculatedPriorityTasks', []);
            // FIXED: Use String() for ID normalization
            const task = priorityTasks.find(t => String(t.id) === String(taskId));
            if (task) return task;
        } catch (e) { console.error("Error reading priority tasks:", e); }

        // 2. Try project lists (subjects)
        try {
            const storage = getStorage();
            const subjects = storage.get('academicSubjects', []);
            for (const subject of subjects) {
                const projectId = subject.tag;
                const tasksKey = `tasks-${projectId}`;
                // Prioritize Firestore if available
                let projectTasks = [];
                if (typeof window.loadTasksFromFirestore === 'function') {
                    try {
                        projectTasks = await window.loadTasksFromFirestore(projectId) || [];
                    } catch (fsError) {
                        console.warn(`Firestore load failed for ${projectId}, falling back to storage.`, fsError);
                        projectTasks = storage.get(tasksKey, []);
                    }
                } else {
                    projectTasks = storage.get(tasksKey, []);
                }

                // FIXED: Use String() for ID normalization
                const task = projectTasks.find(t => String(t.id) === String(taskId));
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
        } catch (e) { console.error("Error reading task from DOM:", e); }

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

            const storage = getStorage();
            const subjects = storage.get('academicSubjects', []);
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
            const storage = getStorage();
            const subjectMaterials = storage.get(cacheKey, {});
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

            storage.set(cacheKey, subjectMaterials);
            console.log(`Drive API: Subject materials cache updated for ${subjectTag}`);
        } catch (e) {
            console.error("Drive API: Failed to update subject materials cache:", e);
        }
    }

    async getSubjectFiles(subjectTag) {
        console.log(`Drive API: Getting files for subject ${subjectTag}...`);

        // Guard: check if gapi is loaded at all
        if (typeof gapi === 'undefined') {
            console.warn('[googleDriveAPI] gapi not loaded yet for getSubjectFiles');
            throw new Error('Google API (gapi) is not loaded. Please wait for page to fully load.');
        }

        // First check if we need to initialize the API
        if (!gapi.client || !gapi.client.drive) {
            console.warn('Drive API: Drive client not available, attempting to initialize...');
            const initialized = await this.initialize();
            if (!initialized) {
                console.error('Drive API: Failed to initialize Drive API for getSubjectFiles');
                throw new Error('Google Drive API could not be initialized. Please refresh the page and try again.');
            }
        }

        try {
            // STRATEGY 1: Strict search by appProperties
            console.log(`Drive API: Attempting strict metadata search for subjectTag=${subjectTag}`);
            let files = [];
            const strictResult = await this.authorizedRequest({
                path: 'https://www.googleapis.com/drive/v3/files',
                method: 'GET',
                params: {
                    q: `appProperties has { key='subjectTag' and value='${subjectTag}' } and trashed=false`,
                    fields: 'files(id, name, mimeType, webViewLink, webContentLink, thumbnailLink, createdTime, appProperties, size, iconLink, parents)',
                    orderBy: 'name'
                }
            });

            if (strictResult.files && strictResult.files.length > 0) {
                console.log(`Drive API: Strict search found ${strictResult.files.length} files.`);
                files = strictResult.files;
            } else {
                console.log('Drive API: Strict search returned no files. Attempting fallback by folder...');
                // STRATEGY 2: Fallback - find folder(s) and list contents
                // This handles files uploaded manually, or "split brain" folder issues (duplicate folders)
                try {
                    // 1. Get App Folder (Root) - assume it exists or create it
                    const appFolderId = await this.getOrCreateAppFolder();
                    const subjectFolderName = `${subjectTag}_Materials`;

                    // 2. Find ALL folders matching the name
                    // We don't use getOrCreate here because we don't want to create duplicates if none exist yet, just searching
                    const cleanFolderName = subjectFolderName.replace(/'/g, "\\'");
                    const folderQuery = `mimeType='application/vnd.google-apps.folder' and name='${cleanFolderName}' and '${appFolderId}' in parents and trashed=false`;

                    const folderSearch = await this.authorizedRequest({
                        path: 'https://www.googleapis.com/drive/v3/files',
                        method: 'GET',
                        params: {
                            q: folderQuery,
                            fields: 'files(id)',
                            corpora: 'user'
                        }
                    });

                    if (folderSearch.files && folderSearch.files.length > 0) {
                        // Build query for ALL found folders
                        const folderIds = folderSearch.files.map(f => `'${f.id}' in parents`);
                        const parentsQuery = `(${folderIds.join(' or ')})`;

                        console.log(`Drive API: Found ${folderSearch.files.length} potential subject folders. Searching in all...`);

                        const folderResult = await this.authorizedRequest({
                            path: 'https://www.googleapis.com/drive/v3/files',
                            method: 'GET',
                            params: {
                                q: `${parentsQuery} and trashed=false`, // Removed explicit fields override to default or use authorizedRequest default
                                fields: 'files(id, name, mimeType, webViewLink, webContentLink, thumbnailLink, createdTime, appProperties, size, iconLink, parents)',
                                orderBy: 'name'
                            }
                        });

                        if (folderResult.files && folderResult.files.length > 0) {
                            console.log(`Drive API: Folder search found ${folderResult.files.length} files.`);
                            files = folderResult.files;
                        }
                    } else {
                        console.log(`Drive API: No folder named '${subjectFolderName}' found.`);
                    }
                } catch (folderError) {
                    console.warn('Drive API: Folder fallback search failed:', folderError);
                }
            }

            console.log(`Drive API: Returning ${files.length} total files for subject ${subjectTag}.`);
            return files;

        } catch (error) {
            console.error(`Drive API: Error getting files for subject ${subjectTag}:`, error);

            // Check if we have cached files in storage as last resort
            try {
                const cacheKey = 'subjectMaterials';
                const storage = getStorage();
                const subjectMaterials = storage.get(cacheKey, {});

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
        if (!this.allowedFileTypes.includes(fileType) && !this.allowedFileTypes.some(allowed => fileType.startsWith(allowed.replace('*', '')))) {
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