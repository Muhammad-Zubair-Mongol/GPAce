const fs = require('fs');
const path = require('path');

// Files from the console errors
const files = [
    'js/currentTaskManager.js',
    'js/pomodoroTimer.js',
    'js/sleepTimeCalculator.js',
    'js/energyLevels.js',
    'js/task-notes.js',
    'js/workspace-attachments.js',
    'js/pomodoroGlobal.js',
    'js/priority-list-sorting.js'
];

const basePath = path.join(__dirname);

console.log('Starting to fix getStorage redeclaration errors...\n');

files.forEach(file => {
    const filePath = path.join(basePath, file);

    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let modified = false;

        // Step 1: Remove `const getStorage = window.getStorage;` line
        const constPattern = /const getStorage = window\.getStorage;/g;
        if (content.match(constPattern)) {
            content = content.replace(constPattern, '// Use window.getStorage() directly to avoid redeclaration errors');
            modified = true;
            console.log(`✓ Removed const declaration in: ${file}`);
        }

        // Step 2: Replace all `getStorage()` with `window.getStorage()`  
        // BUT NOT if it's already `window.getStorage()`
        const usagePattern = /([^.])\bgetStorage\(\)/g;
        const matchCount = (content.match(usagePattern) || []).length;
        if (matchCount > 0) {
            content = content.replace(usagePattern, '$1window.getStorage()');
            modified = true;
            console.log(`✓ Fixed ${matchCount} usage(s) in: ${file}`);
        }

        if (modified) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`✅ Successfully fixed: ${file}\n`);
        } else {
            console.log(`⚠️  No changes needed in: ${file}\n`);
        }
    } catch (error) {
        console.error(`❌ Error processing ${file}:`, error.message, '\n');
    }
});

console.log('Done! Please hard refresh your browser (Ctrl+Shift+R) to see changes.');
