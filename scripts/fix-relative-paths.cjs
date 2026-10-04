const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, search, replacement) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(search)) {
    content = content.replaceAll(search, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

// 1. Fix ApiClient URL resolution across all JS files
const filesWithApiClient = [
  'js/calendarManager.js',
  'js/apiSettingsManager.js',
  'js/timetableAnalyzer.js',
  'js/studySpacesManager.js',
  'js/studySpaceAnalyzer.js',
  'js/controllers/ScheduleController.js'
];

filesWithApiClient.forEach(file => {
  replaceInFile(
    path.join('d:/GPAce', file),
    "const moduleUrl = new URL('/js/services/ApiClient.js', window.location.origin).href;",
    "const moduleUrl = new URL('js/services/ApiClient.js', (typeof document !== 'undefined' && document.baseURI) || (typeof window !== 'undefined' ? window.location.href : 'http://localhost/')).href;"
  );
  replaceInFile(
    path.join('d:/GPAce', file),
    "new URL('/js/services/ApiClient.js', window.location.origin)",
    "new URL('js/services/ApiClient.js', (typeof document !== 'undefined' && document.baseURI) || (typeof window !== 'undefined' ? window.location.href : 'http://localhost/'))"
  );
});

// 2. Fix HTML files with src="/js/inject-header.js"
const htmlFiles = [
  'daily-calendar.html',
  'index.html',
  'instant-test-feedback.html',
  'landing.html',
  'priority-list.html',
  'study-spaces.html',
  'markdown-converter.html'
];

htmlFiles.forEach(file => {
  replaceInFile(path.join('d:/GPAce', file), 'src="/js/inject-header.js"', 'src="js/inject-header.js"');
  replaceInFile(path.join('d:/GPAce', file), 'href="/styles/main.css"', 'href="styles/main.css"');
});

// 3. Fix relaxed-mode/index.html relative paths
const relaxedPath = path.join('d:/GPAce/relaxed-mode/index.html');
replaceInFile(relaxedPath, 'href="/styles/main.css"', 'href="../styles/main.css"');
replaceInFile(relaxedPath, 'href="/css/sideDrawer.css"', 'href="../css/sideDrawer.css"');
replaceInFile(relaxedPath, 'src="/js/', 'src="../js/');

console.log('Path normalization complete.');
