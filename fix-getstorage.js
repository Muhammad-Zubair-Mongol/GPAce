const fs = require('fs');
const path = require('path');

// List of files that need fixing
const files = [
    'js/currentTaskManager.js',
    'js/sleepTimeCalculator.js',
    'js/energyLevels.js',
    'js/pomodoroTimer.js',
    'js/task-notes.js',
    'js/workspace-attachments.js',
    'js/pomodoroGlobal.js',
    'js/priority-list-sorting.js'
];

const basePath = 'e:\\GPAce Finally\\Creating an App\\';

files.forEach(file => {
    const filePath = path.join(basePath, file);

    try {
        let content = fs.readFileSync(filePath, 'utf8');

        // Replace the const getStorage declaration
        const oldPattern = /const getStorage = window\.getStorage;/g;
        const newReplacement = '// Note: Use window.getStorage() directly instead of creating a local const alias\n// to avoid "Identifier \'getStorage\' has already been declared" errors in global scope';

        if (content.match(oldPattern)) {
            content = content.replace(oldPattern, newReplacement);

            // Replace all usages of getStorage() with window.getStorage()
            // Match getStorage() but not window.getStorage()
            content = content.replace(/(?<!window\.)getStorage\(\)/g, 'window.getStorage()');

            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`✅ Fixed: ${file}`);
        } else {
            console.log(`⚠️  Pattern not found in: ${file}`);
        }
    } catch (error) {
        console.error(`❌ Error processing ${file}:`, error.message);
    }
});

console.log('\nDone!');
