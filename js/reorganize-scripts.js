/**
 * Script to reorganize all script imports in HTML files
 * Moves all scripts to the end of the body tag for consistent structure
 */

const fs = require('fs');
const path = require('path');

// List of all HTML files in the codebase
const htmlFiles = [
    'index.html',
    'grind.html',
    'academic-details.html',
    'workspace.html',
    'extracted.html',
    'daily-calendar.html',
    'guide.html',
    'study-spaces.html',
    'subject-marks.html',
    'settings.html',
    'tasks.html',
    'landing.html',
    'sleep-saboteurs.html',
    '404.html',
    'priority-list.html',
    'priority-calculator.html',
    'flashcards.html',
    'relaxed-mode/index.html'
];

/**
 * Reorganize scripts in an HTML file
 * @param {string} filePath - Path to the HTML file
 */
function reorganizeScripts(filePath) {
    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.warn(`File not found: ${filePath}`);
            return;
        }

        // Read file content
        let content = fs.readFileSync(filePath, 'utf8');

        // Find the closing body tag
        const bodyCloseIndex = content.lastIndexOf('</body>');
        if (bodyCloseIndex === -1) {
            console.error(`No closing body tag found in ${filePath}`);
            return;
        }

        // First, remove any existing script section comments
        content = content.replace(/\n\s*<!-- Scripts -->\s*\n/g, '\n');

        // Extract all script tags from the document
        const scriptRegex = /<script[^>]*>[\s\S]*?<\/script>/g;
        const scripts = [];
        let match;

        // Find all script tags and store them
        while ((match = scriptRegex.exec(content)) !== null) {
            scripts.push({
                tag: match[0],
                position: match.index
            });
        }

        // Sort scripts by their position in the document (to maintain order)
        scripts.sort((a, b) => a.position - b.position);

        // Remove all script tags from the content
        content = content.replace(scriptRegex, '');

        // Find the inject-header.js script if it exists
        let injectHeaderScript = '';
        const injectHeaderIndex = scripts.findIndex(script =>
            script.tag.includes('inject-header.js')
        );

        // If inject-header.js exists, remove it from the array to add it last
        if (injectHeaderIndex !== -1) {
            injectHeaderScript = scripts[injectHeaderIndex].tag;
            scripts.splice(injectHeaderIndex, 1);
        }

        // Filter out any empty scripts
        const filteredScripts = scripts.filter(script => script.tag.trim() !== '');

        // Add all scripts before the closing body tag
        let scriptContent = filteredScripts.map(script => script.tag).join('\n    ');

        // Add inject-header.js last if it exists
        if (injectHeaderScript) {
            if (scriptContent) {
                scriptContent += '\n    ' + injectHeaderScript;
            } else {
                scriptContent = injectHeaderScript;
            }
        }

        // Get the content up to the body closing tag
        let contentBeforeBodyClose = content.slice(0, bodyCloseIndex).trim();

        // Get the content after the body closing tag
        let contentAfterBodyClose = '';
        const htmlCloseIndex = content.indexOf('</html>');
        if (htmlCloseIndex > bodyCloseIndex) {
            contentAfterBodyClose = content.slice(htmlCloseIndex);
        } else {
            contentAfterBodyClose = content.slice(bodyCloseIndex + 7); // 7 is the length of '</body>'
        }

        // Insert all scripts before the closing body tag
        content = contentBeforeBodyClose +
                 '\n    <!-- Scripts -->\n    ' +
                 scriptContent +
                 '\n</body>\n</html>';

        // Write the updated content back to the file
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Successfully reorganized scripts in ${filePath}`);
    } catch (error) {
        console.error(`Error updating ${filePath}:`, error);
    }
}

// Process each HTML file
htmlFiles.forEach(file => {
    try {
        const filePath = path.join(__dirname, '..', file);
        console.log(`Processing file: ${filePath}`);
        reorganizeScripts(filePath);
    } catch (error) {
        console.error(`Error processing ${file}:`, error);
    }
});

console.log('Script reorganization completed!');
