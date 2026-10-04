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
    'priority-calculator.html'
];

// Favicon links to add
const faviconLinks = `
    <!-- Favicon -->
    <link rel="icon" type="image/png" href="assets/images/gpace-logo-white.png">
    <link rel="shortcut icon" type="image/png" href="assets/images/gpace-logo-white.png">
`;

function addFaviconToHtml(filePath) {
    try {
        console.log(`Processing ${filePath}...`);
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Check if favicon is already added
        if (content.includes('rel="icon"') || content.includes('rel="shortcut icon"')) {
            console.log(`Favicon already exists in ${filePath}`);
            return;
        }

        // Find the head tag
        const headStartIndex = content.indexOf('<head>');
        const headEndIndex = content.indexOf('</head>');
        
        if (headStartIndex === -1 || headEndIndex === -1) {
            console.error(`No head tags found in ${filePath}`);
            return;
        }

        // Find a good position to insert the favicon links (after title or meta tags)
        const titleEndIndex = content.indexOf('</title>', headStartIndex);
        const metaEndIndex = content.lastIndexOf('</meta>', headEndIndex);
        
        let insertIndex;
        if (titleEndIndex !== -1 && titleEndIndex < headEndIndex) {
            insertIndex = titleEndIndex + 8; // After </title>
        } else if (metaEndIndex !== -1 && metaEndIndex < headEndIndex) {
            insertIndex = metaEndIndex + 7; // After </meta>
        } else {
            // If no title or meta tags, insert after head opening tag
            insertIndex = headStartIndex + 6; // After <head>
        }

        // Insert favicon links
        const updatedContent = 
            content.slice(0, insertIndex) + 
            faviconLinks + 
            content.slice(insertIndex);

        // Write the updated content back to the file
        fs.writeFileSync(filePath, updatedContent, 'utf8');
        console.log(`Successfully added favicon to ${filePath}`);
    } catch (error) {
        console.error(`Error updating ${filePath}:`, error);
    }
}

// Process each HTML file
htmlFiles.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        addFaviconToHtml(filePath);
    } else {
        console.warn(`File not found: ${filePath}`);
    }
});

console.log('Favicon update process completed!');
