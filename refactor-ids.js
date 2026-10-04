/**
 * ID Naming Convention Refactoring Script
 * 
 * Automatically renames DOM IDs to follow kebab-case with 'app-' prefix
 * 
 * Usage: node refactor-ids.js [--dry-run] [--file=path]
 * 
 * Options:
 *   --dry-run    Show what would be changed without making changes
 *   --file=path  Only process a specific file
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const SINGLE_FILE = process.argv.find(a => a.startsWith('--file='))?.split('=')[1];

// IDs to exclude from renaming (third-party, Bootstrap, etc.)
const EXCLUDED_PREFIXES = ['bs-', 'bootstrap-', 'modal-', 'MathJax'];
const EXCLUDED_IDS = new Set([
    'timer', 'notification', 'alarm-sound', // Core app IDs that are fine
]);

/**
 * Convert any naming convention to kebab-case with app- prefix
 */
function toAppKebabCase(id) {
    // Skip if already has app- prefix
    if (id.startsWith('app-')) return id;

    // Skip excluded IDs
    if (EXCLUDED_IDS.has(id)) return id;
    for (const prefix of EXCLUDED_PREFIXES) {
        if (id.startsWith(prefix)) return id;
    }

    // Convert camelCase to kebab-case
    let result = id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    // Convert snake_case to kebab-case
    result = result.replace(/_/g, '-');
    // Add app- prefix
    return 'app-' + result;
}

/**
 * Process a JavaScript file
 */
function processJsFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    let newContent = content;
    const changes = [];

    // Pattern: getElementById('id') or getElementById("id")
    const idPattern = /getElementById\(['"]([^'"]+)['"]\)/g;
    let match;

    while ((match = idPattern.exec(content)) !== null) {
        const oldId = match[1];
        const newId = toAppKebabCase(oldId);

        if (oldId !== newId) {
            changes.push({ oldId, newId, lineNum: content.substring(0, match.index).split('\n').length });
            newContent = newContent.replace(
                new RegExp(`getElementById\\(['"]${oldId}['"]\\)`, 'g'),
                `getElementById('${newId}')`
            );
        }
    }

    // Pattern: querySelector('#id')
    const selectorPattern = /querySelector\(['"]#([^'"]+)['"]\)/g;
    while ((match = selectorPattern.exec(content)) !== null) {
        const oldId = match[1];
        const newId = toAppKebabCase(oldId);

        if (oldId !== newId) {
            changes.push({ oldId, newId, type: 'querySelector' });
            newContent = newContent.replace(
                new RegExp(`querySelector\\(['"]#${oldId}['"]\\)`, 'g'),
                `querySelector('#${newId}')`
            );
        }
    }

    // Pattern: .id = 'value'
    const idAssignPattern = /\.id\s*=\s*['"]([^'"]+)['"]/g;
    while ((match = idAssignPattern.exec(content)) !== null) {
        const oldId = match[1];
        const newId = toAppKebabCase(oldId);

        if (oldId !== newId) {
            changes.push({ oldId, newId, type: 'assignment' });
            newContent = newContent.replace(
                new RegExp(`\\.id\\s*=\\s*['"]${oldId}['"]`, 'g'),
                `.id = '${newId}'`
            );
        }
    }

    return { newContent, changes };
}

/**
 * Process an HTML file
 */
function processHtmlFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    let newContent = content;
    const changes = [];

    // Pattern: id="value"
    const idPattern = /\bid=["']([^"']+)["']/g;
    let match;

    while ((match = idPattern.exec(content)) !== null) {
        const oldId = match[1];
        const newId = toAppKebabCase(oldId);

        if (oldId !== newId) {
            changes.push({ oldId, newId });
            newContent = newContent.replace(
                new RegExp(`\\bid=["']${oldId}["']`, 'g'),
                `id="${newId}"`
            );
        }
    }

    // Pattern: for="value" (label elements)
    const forPattern = /\bfor=["']([^"']+)["']/g;
    while ((match = forPattern.exec(content)) !== null) {
        const oldId = match[1];
        const newId = toAppKebabCase(oldId);

        if (oldId !== newId) {
            changes.push({ oldId, newId, type: 'for-attribute' });
            newContent = newContent.replace(
                new RegExp(`\\bfor=["']${oldId}["']`, 'g'),
                `for="${newId}"`
            );
        }
    }

    return { newContent, changes };
}

/**
 * Main execution
 */
function main() {
    console.log('=== ID Naming Convention Refactoring ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE'}\n`);

    const jsFiles = [];
    const htmlFiles = [];

    // Collect files
    function collectFiles(dir) {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            if (item === 'node_modules' || item === '.git') continue;

            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                collectFiles(fullPath);
            } else if (item.endsWith('.js') && !item.includes('.min.')) {
                jsFiles.push(fullPath);
            } else if (item.endsWith('.html')) {
                htmlFiles.push(fullPath);
            }
        }
    }

    if (SINGLE_FILE) {
        if (SINGLE_FILE.endsWith('.js')) jsFiles.push(SINGLE_FILE);
        else if (SINGLE_FILE.endsWith('.html')) htmlFiles.push(SINGLE_FILE);
    } else {
        collectFiles('.');
    }

    let totalChanges = 0;
    const allMappings = new Map();

    // Process JS files
    console.log(`Processing ${jsFiles.length} JS files...`);
    for (const file of jsFiles) {
        const { newContent, changes } = processJsFile(file);
        if (changes.length > 0) {
            console.log(`  ${file}: ${changes.length} IDs to rename`);
            for (const c of changes) {
                allMappings.set(c.oldId, c.newId);
            }
            totalChanges += changes.length;

            if (!DRY_RUN) {
                fs.writeFileSync(file, newContent, 'utf8');
            }
        }
    }

    // Process HTML files
    console.log(`\nProcessing ${htmlFiles.length} HTML files...`);
    for (const file of htmlFiles) {
        const { newContent, changes } = processHtmlFile(file);
        if (changes.length > 0) {
            console.log(`  ${file}: ${changes.length} IDs to rename`);
            for (const c of changes) {
                allMappings.set(c.oldId, c.newId);
            }
            totalChanges += changes.length;

            if (!DRY_RUN) {
                fs.writeFileSync(file, newContent, 'utf8');
            }
        }
    }

    console.log('\n=== Summary ===');
    console.log(`Total unique IDs renamed: ${allMappings.size}`);
    console.log(`Total ID references updated: ${totalChanges}`);

    if (DRY_RUN) {
        console.log('\n[DRY RUN] No files were modified.');
        console.log('Run without --dry-run to apply changes.');
    } else {
        console.log('\nAll changes applied successfully!');
    }

    // Output mapping file
    const mappingOutput = {
        timestamp: new Date().toISOString(),
        total_ids: allMappings.size,
        mappings: Object.fromEntries(allMappings)
    };

    fs.writeFileSync('.agent/id-refactor-mappings.json', JSON.stringify(mappingOutput, null, 2));
    console.log('\nMapping file saved to .agent/id-refactor-mappings.json');
}

main();
