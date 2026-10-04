/**
 * Script to fix getStorage redeclaration issues across all JS files
 * Handles ALL variations of the pattern
 * Run with: node scripts/fix-getStorage-v3.js
 */

const fs = require('fs');
const path = require('path');

const basePath = path.join(__dirname, '..', 'js');

// Find all JS files
const allFiles = fs.readdirSync(basePath).filter(f => f.endsWith('.js'));

// The new replacement template
const newCode = `// Storage helper with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
const getStorage = window.getStorage;`;

let fixedCount = 0;

allFiles.forEach(file => {
    const filePath = path.join(basePath, file);

    let content = fs.readFileSync(filePath, 'utf8');

    // Check if already fixed
    if (content.includes("typeof window.getStorage")) {
        return; // Already fixed, skip
    }

    // Check if file contains the problematic const getStorage line
    if (!content.includes('const getStorage = () => window.StorageService')) {
        return; // Doesn't have this pattern
    }

    // Find the getStorage declaration and replace it along with its preceding comment
    // This regex handles multiple comment styles and formatting
    const pattern = /(\/\/[^\n]*(?:storage|Storage)[^\n]*\r?\n)?const getStorage = \(\) => window\.StorageService \|\| \{[\s\S]*?\};/;

    if (pattern.test(content)) {
        content = content.replace(pattern, newCode);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Fixed: ${file}`);
        fixedCount++;
    } else {
        console.log(`Pattern not matched but contains getStorage: ${file}`);
    }
});

console.log(`\nTotal files fixed: ${fixedCount}`);
