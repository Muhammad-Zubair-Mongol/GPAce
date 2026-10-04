# GPAce - Your Academic Assistant

GPAce is a web-based academic assistant tool that helps students manage their academic life, including timetables, tasks, and study spaces.

## Verified execution state (2026-09-29)

This workspace contains an evidence-backed release candidate for the 60-step engineering plan. The candidate has a deterministic verification harness, a locked Node 22 baseline, a refreshed structural topology, and a release record in [docs/RELEASE_EVIDENCE.md](docs/RELEASE_EVIDENCE.md). No production deployment or migration was performed.

- Local verification runtime: Node.js 24.18.0 and npm 11.16.0; CI pins Node.js 22.
- Full harness command: `node.exe tests/harness/run-case.cjs --all`.
- Contract checks: `node.exe scripts/check-module-contracts.mjs` passes. The root static checker currently reports the known unpinned external manifest limits; the isolated Step 54 fixture build passed 7/7.
- Harness dependencies are isolated under `tests/harness`; install them with `npm.cmd ci --prefix tests/harness`.
- The local browser matrix and Firestore contract checks use disposable fixtures. The release record lists the unavailable emulator, registry, and external CDN conditions and the reviewed accessibility baseline waivers.

The evidence package is a release-candidate handoff, not a production-release claim. Read the release record before deploying or configuring credentials.

## System Requirements

- **Node.js**: Version 22.0.0 or higher
- **Web Browser**: Modern web browser with JavaScript enabled (Chrome, Firefox, Edge, or Safari)
- **Storage**: Minimum 500MB free space for application and uploads
- **RAM**: Minimum 2GB (4GB recommended)
- **Internet Connection**: Required for API calls and resource loading

## Installation

1. **Install Node.js**:
   - Download and install Node.js from [nodejs.org](https://nodejs.org/)
   - Verify installation by running:
     ```
     node --version
     npm --version
     ```

2. **Clone/Download the Project**:
   - Place the project files in your desired location

3. **Install Dependencies**:
   - Open a terminal/command prompt in the project directory
   - Run:
     ```
     npm.cmd ci
     npm.cmd ci --prefix tests/harness
     ```

4. **Environment Setup**:
   - Create a local `.env` file only when running provider-backed development services; never commit it
   - Add the following configuration:
     ```
     GEMINI_API_KEY=your_gemini_api_key_here
     ```
   - Replace `your_gemini_api_key_here` with your actual Gemini API key

## Running the Application

1. **Start the Server**:
   - Double-click the `start-server.bat` file
   OR
   - Run in terminal:
     ```
     npm start
     ```

2. **Access the Application**:
   - Open your web browser
   - Navigate to: `http://localhost:3000`

## Project Structure

```
/
├── server.js           # Main server file
├── index.html          # Main landing page
├── grind.html          # Focus/Grind mode page
├── extracted.html      # Task extraction page
├── workspace.html      # Workspace management
├── js/
│   ├── core/           # Core system modules
│   │   ├── TaskRepository.js    # Single source of truth for tasks
│   │   └── TaskSystemLoader.js  # Unified system loader
│   ├── components/     # UI components
│   │   ├── SyncStatusIndicator.js
│   │   ├── ConflictModal.js
│   │   └── RecoveryModal.js
│   ├── services/       # Business logic services
│   └── controllers/    # Page controllers
├── styles/             # CSS stylesheets
├── server/             # Server-side modules
├── uploads/            # User uploaded files
└── data/               # Data storage
```

## Features

- Academic timetable management
- Task organization with priority scoring
- Study space finder
- Priority calculator
- Dark/light theme support
- File upload capabilities
- AI-powered analysis using Google's Gemini API
- **Real-time cross-tab synchronization**
- **Automatic backup and recovery system**

---

## Task Synchronization System (v5)

GPAce uses a robust task synchronization system to prevent data loss and ensure consistency across devices and browser tabs.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TaskRepository.js                        │
│              (Single Source of Truth)                       │
├─────────────────────────────────────────────────────────────┤
│  Storage Layer (v5 Format)                                  │
│  ├── gpac_tasks_v5.{projectId}                             │
│  ├── gpac_relaxed_v5                                       │
│  ├── gpac_completed_v5.{projectId}                         │
│  └── gpac_priority_cache_v5                                │
├─────────────────────────────────────────────────────────────┤
│  Sync Layer                                                 │
│  ├── BroadcastChannel (primary)                            │
│  ├── localStorage events (secondary)                       │
│  └── Polling fallback (5s interval)                        │
├─────────────────────────────────────────────────────────────┤
│  Backup Layer (5 rotating slots)                           │
│  ├── gpac_backup_latest                                    │
│  ├── gpac_backup_1h                                        │
│  ├── gpac_backup_6h                                        │
│  ├── gpac_backup_24h                                       │
│  └── gpac_backup_manual                                    │
└─────────────────────────────────────────────────────────────┘
```

### Key Features

1. **v5 Storage Format**: All task data includes version, checksum, deviceId, and timestamp for conflict detection.

2. **Automatic Backups**: Rotating backups at every save + hourly auto-backup.

3. **Cross-Tab Sync**: Changes in one tab automatically reflect in all other open tabs.

4. **Conflict Resolution**: Non-dismissable modal for resolving data conflicts with options:
   - Keep Local Data
   - Keep Remote Data  
   - Smart Merge
   - View Diff

5. **Data Recovery**: Automatic recovery prompt when corruption or data loss is detected.

### API Reference

```javascript
// Initialize (automatically called by TaskSystemLoader)
window.TaskRepository.init();

// Get all tasks for a project
const tasks = window.TaskRepository.getAllTasks(projectId);

// Add a new task
window.TaskRepository.addTask(projectId, taskObject);

// Update an existing task
window.TaskRepository.updateTask(projectId, taskId, updates);

// Complete a task
window.TaskRepository.completeTask(projectId, taskId);

// Delete a task
window.TaskRepository.deleteTask(projectId, taskId);

// Force recovery from backup
window.TaskRepository.forceRecoveryFromBackup('latest'); // or '1h', '6h', '24h', 'manual'

// Export all data (for debugging)
const exportData = window.TaskRepository.exportData();
```

### Convenience API (via window.gpac)

```javascript
// Shorter syntax available after gpac_ready event
window.gpac.getTasks(projectId);
window.gpac.addTask(projectId, task);
window.gpac.savePriorityCache(tasks);
```

### Console Debugging

Look for these log prefixes in browser console:
- `[TaskRepository]` - Core storage operations
- `[TaskSystemLoader]` - System initialization
- `[SyncStatus]` - Sync status changes

---

## Dependencies

- express: ^4.18.2
- multer: ^1.4.5-lts.1
- dotenv: ^16.3.1
- @google/generative-ai: ^0.1.3
- gemini-api: ^1.0.0

## Browser Compatibility

The application is compatible with:
- Google Chrome (latest 2 versions)
- Mozilla Firefox (latest 2 versions)
- Microsoft Edge (latest 2 versions)
- Safari (latest 2 versions)

## Troubleshooting

1. **Server Won't Start**:
   - Check if Node.js is properly installed
   - Verify port 3000 is not in use
   - Ensure all dependencies are installed

2. **Upload Issues**:
   - Check if uploads directory exists and has write permissions
   - Verify file size is under 5MB
   - Ensure file type is supported (JPEG, PNG, GIF)

3. **API Issues**:
   - Verify Gemini API key is correctly set in .env file
   - Check internet connection
   - Ensure API quota is not exceeded

4. **Task Sync Issues**:
   - Check browser console for `[TaskRepository]` errors
   - Try manual backup recovery: `window.TaskRepository.forceRecoveryFromBackup('latest')`
   - Export data for debugging: `console.log(JSON.stringify(window.TaskRepository.exportData()))`

## Support

For issues and support, please check the documentation or contact the development team.
