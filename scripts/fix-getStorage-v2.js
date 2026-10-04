/**
 * Script to fix getStorage redeclaration issues across all JS files
 * Handles multiple variations of the pattern
 * Run with: node scripts/fix-getStorage-v2.js
 */

const fs = require('fs');
const path = require('path');

const basePath = path.join(__dirname, '..', 'js');

// Find all JS files that contain the problematic pattern
const allFiles = fs.readdirSync(basePath).filter(f => f.endsWith('.js'));

// Multiple patterns to match
const patterns = [
    // Pattern 1: "// Storage helper with fallback"
    /\/\/ Storage helper with fallback\r?\nconst getStorage = \(\) => window\.StorageService \|\| \{\r?\n\s+get: \(k, d\) => \{ try \{ return JSON\.parse\(localStorage\.getItem\(k\)\) \?\? d; \} catch \{ return d; \} \},\r?\n\s+set: \(k, v\) => localStorage\.setItem\(k, JSON\.stringify\(v\)\)\r?\n\};/g,

    // Pattern 2: "// Get storage service with fallback"
    /\/\/ Get storage service with fallback\r?\nconst getStorage = \(\) => window\.StorageService \|\| \{\r?\n\s+get: \(k, d\) => \{ try \{ return JSON\.parse\(localStorage\.getItem\(k\)\) \?\? d; \} catch \{ return d; \} \},\r?\n\s+set: \(k, v\) => localStorage\.setItem\(k, JSON\.stringify\(v\)\)\r?\n\};/g
];

const replacements = [
    `// Storage helper with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
const getStorage = window.getStorage;`,

    `// Get storage service with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
const getStorage = window.getStorage;`
];

let fixedCount = 0;

allFiles.forEach(file => {
    const filePath = path.join(basePath, file);

    let content = fs.readFileSync(filePath, 'utf8');

    // Check if already fixed
    if (content.includes("typeof window.getStorage")) {
        return; // Already fixed, skip
    }

    // Check if file contains any of the patterns
    let wasFixed = false;
    for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(content)) {
            // Reset regex lastIndex
            patterns[i].lastIndex = 0;
            content = content.replace(patterns[i], replacements[i]);
            wasFixed = true;
            break;
        }
    }

    if (wasFixed) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Fixed: ${file}`);
        fixedCount++;
    }
});

console.log(`\nTotal files fixed: ${fixedCount}`);
