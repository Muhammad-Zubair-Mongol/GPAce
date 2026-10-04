/**
 * Batch fix script for getStorage consolidation
 * This script removes inline getStorage fallback patterns and replaces them 
 * with imports from StorageAdapter.js
 */

const fs = require('fs');
const path = require('path');

// Files that need the window.getStorage guard pattern removed and replaced with import
const filesToFix = [
    'js/workspaceFlashcardIntegration.js',
    'js/workspace-document.js',
    'js/workspace-core.js',
    'js/weightage-connector.js',
    'js/userGuidance.js',
    'js/todoistIntegration.js',
    'js/themeManager.js',
    'js/theme-manager.js',
    'js/text-expansion.js',
    'js/test-feedback.js',
    'js/soundManager.js',
    'js/sleepScheduleManager.js',
    'js/scheduleManager.js',
    'js/roleModelManager.js',
    'js/recipeManager.js',
    'js/quoteManager.js',
    'js/priority-worker-wrapper.js',
    'js/priority-sync-fix.js',
    'js/priority-list-utils.js',
    'js/gemini-api.js',
    'js/flashcards.js',
    'js/flashcardManager.js',
    'js/calendarManager.js',
    'js/calendar-views.js',
    'js/api-settings.js',
    'js/api-optimization.js',
    'js/ai-researcher.js'
];

// Pattern to match the guard + assignment block
const guardPattern = /if\s*\(\s*typeof\s+window\.getStorage\s*===?\s*['"]undefined['"]\s*\)\s*\{[\s\S]*?window\.getStorage\s*=[\s\S]*?\}\s*\n?\s*const\s+getStorage\s*=\s*window\.getStorage\s*;?/g;

// Simple assignment pattern
const simplePattern = /const\s+getStorage\s*=\s*window\.getStorage\s*;?/g;

// Import statement to add (for module files)
const importStatement = "import { getStorage } from './utils/StorageAdapter.js';";

let fixedCount = 0;
let skippedCount = 0;

filesToFix.forEach(file => {
    const filePath = path.join(__dirname, file);

    if (!fs.existsSync(filePath)) {
        console.log(`[SKIP] File not found: ${file}`);
        skippedCount++;
        return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Check if file is a module (has import/export)
    const isModule = /^(import|export)\s+/m.test(content);

    // Check if it already has the StorageAdapter import
    const hasStorageImport = content.includes("from './utils/StorageAdapter.js'");

    // Remove guard pattern if present
    if (guardPattern.test(content)) {
        content = content.replace(guardPattern, '');
        modified = true;
        console.log(`[FIX] Removed guard pattern from: ${file}`);
    }

    // Remove simple assignment pattern
    if (simplePattern.test(content)) {
        content = content.replace(simplePattern, '');
        modified = true;
        console.log(`[FIX] Removed simple pattern from: ${file}`);
    }

    // Add import if it's a module and doesn't have it
    if (isModule && !hasStorageImport && modified) {
        // Find the first import statement or the start of the file
        const firstImportMatch = content.match(/^import\s+/m);
        if (firstImportMatch) {
            // Add after existing imports
            const lastImportIndex = content.lastIndexOf('import ');
            const endOfLastImport = content.indexOf('\n', lastImportIndex);
            content = content.slice(0, endOfLastImport + 1) +
                importStatement + '\n' +
                content.slice(endOfLastImport + 1);
        } else {
            // Add at the start
            content = importStatement + '\n\n' + content;
        }
        console.log(`[FIX] Added StorageAdapter import to: ${file}`);
    }

    if (modified) {
        // Clean up extra blank lines
        content = content.replace(/\n{3,}/g, '\n\n');
        fs.writeFileSync(filePath, content, 'utf8');
        fixedCount++;
    } else {
        console.log(`[SKIP] No changes needed for: ${file}`);
        skippedCount++;
    }
});

console.log(`\n=== Summary ===`);
console.log(`Fixed: ${fixedCount} files`);
console.log(`Skipped: ${skippedCount} files`);
