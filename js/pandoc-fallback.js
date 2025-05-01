/**
 * Fallback script for Markdown to DOCX conversion
 * 
 * This script provides a simple fallback when Pandoc.js WebAssembly is not available.
 * It uses a very basic Markdown to HTML conversion and then creates a downloadable
 * text file with the HTML content.
 */

// Simple Markdown to HTML converter
function markdownToHTML(markdown) {
  if (!markdown) return '';
  
  // Replace newlines with <br>
  let html = markdown.replace(/\n/g, '<br>');
  
  // Bold: **text** or __text__
  html = html.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
  
  // Italic: *text* or _text_
  html = html.replace(/(\*|_)(.*?)\1/g, '<em>$2</em>');
  
  // Headers: # Header 1, ## Header 2, etc.
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  
  // Links: [text](url)
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
  
  // Images: ![alt](url)
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1">');
  
  // Code blocks: ```code```
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  
  // Inline code: `code`
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  
  return html;
}

// Function to create a simple HTML document
function createHTMLDocument(markdownContent) {
  const htmlContent = markdownToHTML(markdownContent);
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Converted Document</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; margin: 20px; }
    h1, h2, h3 { color: #333; }
    code, pre { background-color: #f5f5f5; padding: 2px 5px; border-radius: 3px; }
    pre { padding: 10px; overflow: auto; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
}

// Function to convert markdown to a downloadable HTML file
function convertMarkdownToHTML(markdownContent) {
  const htmlDocument = createHTMLDocument(markdownContent);
  const blob = new Blob([htmlDocument], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = 'converted_document.html';
  document.body.appendChild(a);
  a.click();
  
  // Clean up
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Export the function for use in the main script
window.fallbackConverter = {
  convertMarkdownToHTML: convertMarkdownToHTML
};
