// data-sync-manager.js - Manages consistent data synchronization across pages

import { 
    loadWeightagesFromFirestore, 
    loadSubjectMarksFromFirestore,
    loadSubjectsFromFirestore,
    loadTasksFromFirestore
} from './firestore.js';

class DataSyncManager {
    constructor() {
        this.syncInProgress = false;
        this.lastSyncTimestamp = null;
        this.SYNC_INTERVAL = 300000; // 5 minutes
        this.loadingIndicators = new Set();
    }

    // Show loading indicator
    showLoadingIndicator(id = 'default') {
        this.loadingIndicators.add(id);
        this.updateLoadingUI();
    }

    // Hide loading indicator
    hideLoadingIndicator(id = 'default') {
        this.loadingIndicators.delete(id);
        this.updateLoadingUI();
    }

    // Update loading UI
    updateLoadingUI() {
        const loadingOverlay = document.getElementById('syncLoadingOverlay') || this.createLoadingOverlay();
        if (this.loadingIndicators.size > 0) {
            loadingOverlay.style.display = 'flex';
        } else {
            loadingOverlay.style.display = 'none';
        }
    }

    // Create loading overlay if it doesn't exist
    createLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'syncLoadingOverlay';
        overlay.innerHTML = `
            <div class="sync-loading-content">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <div class="sync-loading-text">Syncing data...</div>
            </div>
        `;
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            #syncLoadingOverlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: none;
                justify-content: center;
                align-items: center;
                z-index: 9999;
            }
            .sync-loading-content {
                background: white;
                padding: 20px;
                border-radius: 8px;
                text-align: center;
            }
            .sync-loading-text {
                margin-top: 10px;
                color: #333;
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        return overlay;
    }

    // Check if sync is needed
    needsSync() {
        if (!this.lastSyncTimestamp) return true;
        return Date.now() - this.lastSyncTimestamp > this.SYNC_INTERVAL;
    }

    // Initialize data sync
    async initializeDataSync(forceSync = false) {
        if (this.syncInProgress) return;
        
        try {
            this.syncInProgress = true;
            
            // Check if sync is needed
            if (!forceSync && !this.needsSync()) {
                console.log('🔄 Recent sync found, using cached data');
                return;
            }

            this.showLoadingIndicator('initialSync');
            
            // Check authentication
            const user = window.auth?.currentUser;
            if (!user) {
                console.log('⚠️ No authenticated user, using cached data');
                return;
            }

            console.log('🔄 Starting data synchronization...');

            // Load all required data
            const [subjects, weightages, marks] = await Promise.all([
                this.loadWithRetry(() => loadSubjectsFromFirestore()),
                this.loadWithRetry(() => loadWeightagesFromFirestore()),
                this.loadWithRetry(() => loadSubjectMarksFromFirestore())
            ]);

            // Load tasks for each subject
            if (subjects && Array.isArray(subjects)) {
                for (const subject of subjects) {
                    await this.loadWithRetry(() => loadTasksFromFirestore(subject.tag));
                }
            }

            // Update sync timestamp
            this.lastSyncTimestamp = Date.now();
            localStorage.setItem('lastWeightageSync', this.lastSyncTimestamp);

            // Trigger priority recalculation if function exists
            if (typeof window.updatePriorityScores === 'function') {
                window.updatePriorityScores();
            }

            console.log('✅ Data synchronization complete');
            
            // Dispatch event for other components
            window.dispatchEvent(new CustomEvent('dataSyncComplete', {
                detail: { timestamp: this.lastSyncTimestamp }
            }));

        } catch (error) {
            console.error('❌ Error during data sync:', error);
            // Use cached data as fallback
            this.useCachedData();
        } finally {
            this.syncInProgress = false;
            this.hideLoadingIndicator('initialSync');
        }
    }

    // Load with retry mechanism
    async loadWithRetry(loadFunction, maxRetries = 3) {
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await loadFunction();
            } catch (error) {
                lastError = error;
                console.warn(`Retry ${i + 1}/${maxRetries} failed:`, error);
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
        
        throw lastError;
    }

    // Use cached data as fallback
    useCachedData() {
        console.log('⚠️ Using cached data due to sync failure');
        // Load from localStorage
        const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
        const weightages = JSON.parse(localStorage.getItem('projectWeightages') || '{}');
        const marks = JSON.parse(localStorage.getItem('subjectMarks') || '{}');
        
        return { subjects, weightages, marks };
    }

    // Start periodic sync
    startPeriodicSync() {
        setInterval(() => {
            if (this.needsSync()) {
                this.initializeDataSync();
            }
        }, this.SYNC_INTERVAL);
    }
}

// Create and export singleton instance
const dataSyncManager = new DataSyncManager();
export default dataSyncManager;

// Make available globally
window.dataSyncManager = dataSyncManager; 