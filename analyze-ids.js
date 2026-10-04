const fs = require('fs');
const path = require('path');

// Recursively get all JS files
function getAllJsFiles(dir) {
    const files = [];
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && !item.includes('node_modules')) {
            files.push(...getAllJsFiles(fullPath));
        } else if (item.endsWith('.js')) {
            files.push(fullPath);
        }
    }
    return files;
}

// Extract IDs from file content
function extractIds(content) {
    const patterns = [
        /getElementById\(['"]([^'"]+)['"]\)/g,
        /querySelector\(['"]#([^'"]+)['"]\)/g,
        /\.id\s*=\s*['"]([^'"]+)['"]/g
    ];
    const ids = new Set();
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            ids.add(match[1]);
        }
    }
    return [...ids];
}

// Classify naming convention
function classifyId(id) {
    if (id.includes('-')) return 'kebab-case';
    if (id.includes('_')) return 'snake_case';
    if (/[A-Z]/.test(id)) return 'camelCase';
    return 'lowercase';
}

// Convert to new naming convention
function toKebabCase(id) {
    // Handle camelCase
    let result = id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    // Handle snake_case
    result = result.replace(/_/g, '-');
    // Add prefix if not present
    if (!result.startsWith('app-')) {
        result = 'app-' + result;
    }
    return result;
}

const jsDir = 'js';
const files = getAllJsFiles(jsDir);
const allIds = new Map(); // id -> {files: [], convention: ''}
const conventionCounts = { 'kebab-case': 0, 'snake_case': 0, 'camelCase': 0, 'lowercase': 0 };

for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const ids = extractIds(content);
    const relPath = file.replace(/\\/g, '/');

    for (const id of ids) {
        if (!allIds.has(id)) {
            const convention = classifyId(id);
            allIds.set(id, { files: [relPath], convention });
            conventionCounts[convention]++;
        } else {
            if (!allIds.get(id).files.includes(relPath)) {
                allIds.get(id).files.push(relPath);
            }
        }
    }
}

// Generate mappings
const mappings = [];
const idList = [...allIds.entries()].sort((a, b) => a[0].localeCompare(b[0]));

for (const [oldId, data] of idList) {
    const newId = toKebabCase(oldId);
    for (const file of data.files) {
        if (oldId !== newId) {
            mappings.push({
                file: file,
                old_id: oldId,
                new_id: newId,
                current_convention: data.convention
            });
        }
    }
}

// Determine optimal convention (least changes)
const sorted = Object.entries(conventionCounts).sort((a, b) => b[1] - a[1]);
const optimalConvention = sorted[0][0];
const refactorCost = allIds.size - conventionCounts['kebab-case'];

const result = {
    convention_selected: "kebab-case with 'app-' prefix",
    total_ids_found: allIds.size,
    refactor_cost_score: refactorCost,
    convention_breakdown: conventionCounts,
    optimal_existing: optimalConvention,
    id_mappings: mappings.slice(0, 100), // First 100 for brevity
    total_mappings: mappings.length,
    notes: `Found ${allIds.size} unique IDs across ${files.length} JS files. ${conventionCounts['camelCase']} use camelCase, ${conventionCounts['kebab-case']} use kebab-case, ${conventionCounts['snake_case']} use snake_case, ${conventionCounts['lowercase']} use lowercase. Recommended: Adopt kebab-case with 'app-' prefix for consistency.`
};

console.log(JSON.stringify(result, null, 2));
