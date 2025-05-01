const fs = require('fs');
const path = require('path');

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
    'sleep-saboteurs.html'
];

function addInjectHeaderScript(filePath) {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Check if the script is already added
        if (content.includes('inject-header.js')) {
            console.log(`Script already exists in ${filePath}`);
            return;
        }

        // Find the closing body tag
        const bodyCloseIndex = content.lastIndexOf('</body>');
        if (bodyCloseIndex === -1) {
            console.error(`No closing body tag found in ${filePath}`);
            return;
        }

        // Add the script before the closing body tag
        const scriptTag = '<script src="/js/inject-header.js"></script>\n    ';
        content = content.slice(0, bodyCloseIndex) + scriptTag + content.slice(bodyCloseIndex);

        // Write the updated content back to the file
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Successfully updated ${filePath}`);
    } catch (error) {
        console.error(`Error updating ${filePath}:`, error);
    }
}

// Update each HTML file
htmlFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    addInjectHeaderScript(filePath);
}); 