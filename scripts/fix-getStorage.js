/**
 * Script to fix getStorage redeclaration issues across all JS files
 * Run with: node scripts/fix-getStorage.js
 */

const fs = require('fs');
const path = require('path');

const basePath = path.join(__dirname, '..', 'js');

const files = [
    'workspaceFlashcardIntegration.js',
    'workspace-document.js',
    'workspace-core.js',
    'weightage-connector.js',
    'userGuidance.js',
    'todoistIntegration.js',
    'themeManager.js',
    'theme-manager.js',
    'text-expansion.js',
    'test-feedback.js',
    'soundManager.js',
    'sleepScheduleManager.js',
    'scheduleManager.js',
    'roleModelManager.js',
    'recipeManager.js',
    'quoteManager.js',
    'priority-worker-wrapper.js',
    'priority-sync-fix.js',
    'priority-list-utils.js',
    'gemini-api.js',
    'flashcards.js',
    'flashcardManager.js',
    'calendarManager.js',
    'calendar-views.js',
    'api-settings.js',
    'api-optimization.js',
    'alarm-data-service.js',
    'ai-researcher.js'
];

const oldPattern = /\/\/ Storage helper with fallback\r?\nconst getStorage = \(\) => window\.StorageService \|\| \{\r?\n\s+get: \(k, d\) => \{ try \{ return JSON\.parse\(localStorage\.getItem\(k\)\) \?\? d; \} catch \{ return d; \} \},\r?\n\s+set: \(k, v\) => localStorage\.setItem\(k, JSON\.stringify\(v\)\)\r?\n\};/g;

const newContent = `// Storage helper with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
const getStorage = window.getStorage;`;

let fixedCount = 0;

files.forEach(file => {
    const filePath = path.join(basePath, file);

    if (!fs.existsSync(filePath)) {
        console.log(`Not found: ${file}`);
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Check if already fixed
    if (content.includes("typeof window.getStorage")) {
        console.log(`Already fixed: ${file}`);
        return;
    }

    // Check if matches the pattern
    if (oldPattern.test(content)) {
        content = content.replace(oldPattern, newContent);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Fixed: ${file}`);
        fixedCount++;
    } else {
        console.log(`Pattern not found: ${file}`);
    }
});

console.log(`\nTotal files fixed: ${fixedCount}`);
