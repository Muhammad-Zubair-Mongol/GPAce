// Markdown to DOCX Converter Client-side Script using docx.js

document.addEventListener('DOMContentLoaded', function() {
    // Check if required libraries are available
    checkLibrariesAvailability();

    // Set up form submission
    const markdownForm = document.getElementById('markdownForm');
    if (markdownForm) {
        markdownForm.addEventListener('submit', handleFormSubmit);
    }
});

/**
 * Check if required libraries are available
 */
function checkLibrariesAvailability() {
    const statusElement = document.getElementById('converterStatus');

    if (!window.docxAvailable || !window.markedAvailable) {
        if (statusElement) {
            statusElement.className = 'pandoc-status pandoc-fail';
            statusElement.innerHTML = 'Error: Required libraries are not available. Please check your internet connection.';
        }
        showFlashMessage('Required libraries could not be loaded. Please check your internet connection or try a different browser.', 'error');
        return false;
    }

    if (statusElement) {
        statusElement.className = 'pandoc-status pandoc-ok';
        statusElement.innerHTML = 'Ready to convert Markdown to DOCX';
    }

    return true;
}

/**
 * Handle form submission
 * @param {Event} event - The form submission event
 */
async function handleFormSubmit(event) {
    event.preventDefault();

    const markdownInput = document.getElementById('markdownInput').value.trim();
    if (!markdownInput) {
        showFlashMessage('No Markdown content provided.', 'info');
        return;
    }

    // Show loading message
    showFlashMessage('Converting your Markdown to DOCX...', 'info');

    try {
        // Check if libraries are available
        if (!window.docxAvailable || !window.markedAvailable) {
            throw new Error('Required libraries are not available');
        }

        // Convert markdown to HTML using marked.js
        const htmlContent = marked.parse(markdownInput);

        // Convert HTML to DOCX using docx.js
        await convertHtmlToDocx(htmlContent);

        showFlashMessage('Conversion successful! Your document has been downloaded.', 'success');
    } catch (error) {
        console.error('Conversion failed:', error);
        showFlashMessage(`Conversion failed: ${error.message}. Please try again or use a different browser.`, 'error');
    }
}

/**
 * Convert HTML to DOCX using docx.js
 * @param {string} htmlContent - The HTML content to convert
 */
async function convertHtmlToDocx(htmlContent) {
    // Create a temporary div to parse the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;

    // Create a new document
    const doc = new docx.Document({
        sections: [{
            properties: {},
            children: []
        }]
    });

    // Process the HTML content and add elements to the document
    const children = [];

    // Add a title
    children.push(new docx.Paragraph({
        text: 'Converted from Markdown',
        heading: docx.HeadingLevel.HEADING_1,
        spacing: {
            after: 200
        }
    }));

    // Process paragraphs
    const paragraphs = tempDiv.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre');
    paragraphs.forEach(paragraph => {
        if (paragraph.tagName === 'P') {
            children.push(createParagraph(paragraph));
        } else if (paragraph.tagName.match(/^H[1-6]$/)) {
            const level = parseInt(paragraph.tagName.substring(1));
            children.push(createHeading(paragraph, level));
        } else if (paragraph.tagName === 'UL' || paragraph.tagName === 'OL') {
            children.push(...createList(paragraph, paragraph.tagName === 'OL'));
        } else if (paragraph.tagName === 'BLOCKQUOTE') {
            children.push(createBlockquote(paragraph));
        } else if (paragraph.tagName === 'PRE') {
            children.push(createCodeBlock(paragraph));
        }
    });

    // Add all children to the document
    doc.addSection({
        properties: {},
        children: children
    });

    // Generate the document
    const buffer = await docx.Packer.toBlob(doc);

    // Save the document
    saveAs(buffer, 'converted_document.docx');
}

/**
 * Create a paragraph element
 * @param {HTMLElement} element - The HTML element to convert
 * @returns {docx.Paragraph} - The docx paragraph
 */
function createParagraph(element) {
    const textRuns = processTextWithFormatting(element);

    return new docx.Paragraph({
        children: textRuns,
        spacing: {
            after: 200
        }
    });
}

/**
 * Create a heading element
 * @param {HTMLElement} element - The HTML element to convert
 * @param {number} level - The heading level (1-6)
 * @returns {docx.Paragraph} - The docx heading
 */
function createHeading(element, level) {
    const headingLevel = [
        docx.HeadingLevel.HEADING_1,
        docx.HeadingLevel.HEADING_2,
        docx.HeadingLevel.HEADING_3,
        docx.HeadingLevel.HEADING_4,
        docx.HeadingLevel.HEADING_5,
        docx.HeadingLevel.HEADING_6
    ][level - 1];

    const textRuns = processTextWithFormatting(element);

    return new docx.Paragraph({
        children: textRuns,
        heading: headingLevel,
        spacing: {
            after: 200
        }
    });
}

/**
 * Create a list of paragraphs
 * @param {HTMLElement} element - The HTML list element to convert
 * @param {boolean} ordered - Whether the list is ordered
 * @returns {docx.Paragraph[]} - Array of docx paragraphs
 */
function createList(element, ordered) {
    const items = element.querySelectorAll('li');
    const paragraphs = [];

    items.forEach((item, index) => {
        const textRuns = processTextWithFormatting(item);

        paragraphs.push(new docx.Paragraph({
            children: textRuns,
            bullet: {
                level: 0
            },
            spacing: {
                after: 100
            }
        }));
    });

    return paragraphs;
}

/**
 * Create a blockquote
 * @param {HTMLElement} element - The HTML blockquote element to convert
 * @returns {docx.Paragraph} - The docx paragraph
 */
function createBlockquote(element) {
    const textRuns = processTextWithFormatting(element);

    return new docx.Paragraph({
        children: textRuns,
        indent: {
            left: 400
        },
        spacing: {
            after: 200
        }
    });
}

/**
 * Create a code block
 * @param {HTMLElement} element - The HTML pre element to convert
 * @returns {docx.Paragraph} - The docx paragraph
 */
function createCodeBlock(element) {
    const text = element.textContent;

    return new docx.Paragraph({
        children: [
            new docx.TextRun({
                text: text,
                font: 'Courier New'
            })
        ],
        spacing: {
            after: 200
        },
        shading: {
            type: docx.ShadingType.SOLID,
            color: 'F5F5F5'
        }
    });
}

/**
 * Process text with formatting
 * @param {HTMLElement} element - The HTML element to process
 * @returns {docx.TextRun[]} - Array of docx text runs
 */
function processTextWithFormatting(element) {
    const textRuns = [];

    // Process child nodes to handle formatting
    processChildNodes(element, textRuns);

    // If no text runs were created, add the plain text
    if (textRuns.length === 0) {
        const text = element.textContent.trim();
        if (text) {
            textRuns.push(new docx.TextRun({
                text: text
            }));
        }
    }

    return textRuns;
}

/**
 * Process child nodes recursively to handle formatting
 * @param {Node} node - The node to process
 * @param {docx.TextRun[]} textRuns - Array of text runs to append to
 */
function processChildNodes(node, textRuns) {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) {
            textRuns.push(new docx.TextRun({
                text: text
            }));
        }
        return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
    }

    // Handle different element types
    switch (node.nodeName.toLowerCase()) {
        case 'strong':
        case 'b':
            const boldText = node.textContent.trim();
            if (boldText) {
                textRuns.push(new docx.TextRun({
                    text: boldText,
                    bold: true
                }));
            }
            break;

        case 'em':
        case 'i':
            const italicText = node.textContent.trim();
            if (italicText) {
                textRuns.push(new docx.TextRun({
                    text: italicText,
                    italic: true
                }));
            }
            break;

        case 'u':
            const underlinedText = node.textContent.trim();
            if (underlinedText) {
                textRuns.push(new docx.TextRun({
                    text: underlinedText,
                    underline: {}
                }));
            }
            break;

        case 'code':
            const codeText = node.textContent.trim();
            if (codeText) {
                textRuns.push(new docx.TextRun({
                    text: codeText,
                    font: 'Courier New'
                }));
            }
            break;

        case 'a':
            const linkText = node.textContent.trim();
            const href = node.getAttribute('href') || '';
            if (linkText) {
                textRuns.push(new docx.TextRun({
                    text: linkText,
                    color: '0000FF',
                    underline: {}
                }));

                if (href) {
                    textRuns.push(new docx.TextRun({
                        text: ` (${href})`,
                        color: '666666',
                        size: 16
                    }));
                }
            }
            break;

        default:
            // Recursively process child nodes for other elements
            for (const childNode of node.childNodes) {
                processChildNodes(childNode, textRuns);
            }
            break;
    }
}

/**
 * Show a flash message to the user
 * @param {string} message - The message to display
 * @param {string} type - The type of message (success, error, info, error_details)
 */
function showFlashMessage(message, type) {
    const flashContainer = document.getElementById('flashMessages');
    if (!flashContainer) return;

    const flashDiv = document.createElement('div');
    flashDiv.className = `flash flash-${type}`;

    if (type === 'error_details') {
        flashDiv.innerHTML = `<strong>Error Details:</strong><pre>${message}</pre>`;
    } else {
        flashDiv.textContent = message;
    }

    // Add a close button
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn-close float-end';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.addEventListener('click', function() {
        flashDiv.remove();
    });

    flashDiv.prepend(closeButton);

    // Add the flash message to the container
    flashContainer.appendChild(flashDiv);

    // Auto-remove success and info messages after 5 seconds
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            if (flashDiv.parentNode) {
                flashDiv.remove();
            }
        }, 5000);
    }
}
