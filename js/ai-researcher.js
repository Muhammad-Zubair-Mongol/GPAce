
import {
  GoogleGenerativeAI
} from '@google/generative-ai';
import {
  marked
} from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';
// Configure marked options
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
});
// AI Researcher Configuration
let apiKeys = {
  gemini: localStorage.getItem('geminiApiKey') || '',
  wolframAlpha: localStorage.getItem('wolframAlphaApiKey') || '',
  tavily: localStorage.getItem('tavilyApiKey') || '',
  geminiModel: localStorage.getItem('geminiModel') || 'gemini-2.0-flash',
  temperature: parseFloat(localStorage.getItem('geminiTemperature') || '0.4')
};

// Helper function to get a descriptive text for temperature values
function getTemperatureDescription(temp) {
  temp = parseFloat(temp);
  if (temp <= 0.2) return 'precise';
  if (temp <= 0.4) return 'balanced';
  if (temp <= 0.7) return 'varied';
  return 'creative';
}

// Function to update the temperature display based on the slider value
function updateTemperatureDisplay(value) {
  const temperatureDisplay = document.getElementById('temperatureDisplay');
  if (temperatureDisplay) {
    const temp = parseFloat(value);
    let displayText = '';

    // Set the appropriate text and class based on temperature
    if (temp <= 0.2) {
      displayText = `Precise (${temp})`;
      temperatureDisplay.className = 'badge bg-info';
    } else if (temp <= 0.4) {
      displayText = `Balanced (${temp})`;
      temperatureDisplay.className = 'badge bg-primary';
    } else if (temp <= 0.7) {
      displayText = `Varied (${temp})`;
      temperatureDisplay.className = 'badge bg-success';
    } else {
      displayText = `Creative (${temp})`;
      temperatureDisplay.className = 'badge bg-warning';
    }

    temperatureDisplay.textContent = displayText;
  }
}
// Track uploaded files
let uploadedImage = null;
let uploadedPdf = null;
let pdfPageCount = 0;
let pdfPageRange = { start: 1, end: 1 };
let pdfProcessingMode = 'intelligent'; // 'intelligent', 'text', 'visual'
// Handle file selection
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Clear any previously uploaded files
  clearSelectedImage();

  if (file.type.startsWith('image/')) {
    uploadedImage = file;
    document.getElementById('selectedFileName').textContent = file.name;
    document.getElementById('clearImage').style.display = 'flex';
    document.getElementById('fileInfo').style.display = 'flex';
  } else if (file.type === 'application/pdf') {
    handlePdfUpload(file);
  }
}

// Handle PDF upload
async function handlePdfUpload(file) {
  try {
    uploadedPdf = file;
    document.getElementById('selectedFileName').textContent = file.name + ' (loading...)';
    document.getElementById('clearImage').style.display = 'flex';
    document.getElementById('fileInfo').style.display = 'flex';

    // Load the PDF to get page count
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
    pdfPageCount = pdf.numPages;

    // Set default page range to first 3 pages or all pages if less than 3
    pdfPageRange = {
      start: 1,
      end: Math.min(3, pdfPageCount)
    };

    // Update UI with PDF info
    document.getElementById('selectedFileName').textContent =
      `${file.name} (${pdfPageCount} pages, analyzing ${pdfPageRange.start}-${pdfPageRange.end})`;

    // Show PDF options if not already visible
    showPdfOptions();

    showNotification(`PDF loaded with ${pdfPageCount} pages. Processing first ${pdfPageRange.end} pages.`, 'success');
  } catch (error) {
    console.error('Error loading PDF:', error);
    showNotification('Error loading PDF: ' + error.message, 'error');
    clearSelectedImage();
  }
}

// Show PDF options UI
function showPdfOptions() {
  // Check if PDF options already exist
  let pdfOptions = document.getElementById('pdfOptions');
  if (!pdfOptions) {
    // Create PDF options UI
    pdfOptions = document.createElement('div');
    pdfOptions.id = 'pdfOptions';
    pdfOptions.className = 'pdf-options';
    pdfOptions.innerHTML = `
      <div class="pdf-options-header">PDF Processing Options</div>
      <div class="pdf-options-content">
        <div class="form-group">
          <label for="pdfPageRange">Page Range:</label>
          <div class="range-inputs">
            <input type="number" id="pdfPageStart" min="1" value="1" class="form-control form-control-sm">
            <span>to</span>
            <input type="number" id="pdfPageEnd" min="1" class="form-control form-control-sm">
          </div>
        </div>
        <div class="form-group">
          <label>Processing Mode:</label>
          <div class="mode-options">
            <label class="mode-option">
              <input type="radio" name="pdfMode" value="intelligent" checked>
              <span>Intelligent (recommended)</span>
            </label>
            <label class="mode-option">
              <input type="radio" name="pdfMode" value="text">
              <span>Text extraction</span>
            </label>
            <label class="mode-option">
              <input type="radio" name="pdfMode" value="visual">
              <span>Visual analysis</span>
            </label>
          </div>
        </div>
      </div>
    `;

    // Add PDF options after file info
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.parentNode.insertBefore(pdfOptions, fileInfo.nextSibling);

    // Set max value for page end input
    document.getElementById('pdfPageEnd').value = Math.min(3, pdfPageCount);
    document.getElementById('pdfPageEnd').max = pdfPageCount;
    document.getElementById('pdfPageStart').max = pdfPageCount;

    // Add event listeners for page range inputs
    document.getElementById('pdfPageStart').addEventListener('change', updatePdfPageRange);
    document.getElementById('pdfPageEnd').addEventListener('change', updatePdfPageRange);

    // Add event listeners for mode options
    const modeOptions = document.querySelectorAll('input[name="pdfMode"]');
    modeOptions.forEach(option => {
      option.addEventListener('change', (e) => {
        pdfProcessingMode = e.target.value;
      });
    });

    // Add some basic styles for PDF options
    const style = document.createElement('style');
    style.textContent = `
      .pdf-options {
        margin-top: 10px;
        padding: 10px;
        background-color: #f8f9fa;
        border-radius: 5px;
        font-size: 0.9rem;
      }
      .pdf-options-header {
        font-weight: bold;
        margin-bottom: 8px;
      }
      .range-inputs {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .range-inputs input {
        width: 60px;
      }
      .mode-options {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .mode-option {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-bottom: 0;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  } else {
    // Update existing PDF options
    document.getElementById('pdfPageStart').value = pdfPageRange.start;
    document.getElementById('pdfPageEnd').value = pdfPageRange.end;
    document.getElementById('pdfPageEnd').max = pdfPageCount;
    document.getElementById('pdfPageStart').max = pdfPageCount;

    // Show the options if they were hidden
    pdfOptions.style.display = 'block';
  }
}

// Update PDF page range from inputs
function updatePdfPageRange() {
  const startInput = document.getElementById('pdfPageStart');
  const endInput = document.getElementById('pdfPageEnd');

  let start = parseInt(startInput.value, 10);
  let end = parseInt(endInput.value, 10);

  // Validate inputs
  if (isNaN(start) || start < 1) start = 1;
  if (isNaN(end) || end < start) end = start;
  if (end > pdfPageCount) end = pdfPageCount;
  if (start > pdfPageCount) start = pdfPageCount;

  // Update inputs with validated values
  startInput.value = start;
  endInput.value = end;

  // Update page range
  pdfPageRange = { start, end };

  // Update file name display
  if (uploadedPdf) {
    document.getElementById('selectedFileName').textContent =
      `${uploadedPdf.name} (${pdfPageCount} pages, analyzing ${start}-${end})`;
  }
}
// Handle paste event
function handlePaste(event) {
  console.log('Paste event detected');
  try {
    const clipboardData = event.clipboardData || window.clipboardData || event.originalEvent.clipboardData;
    if (!clipboardData || !clipboardData.items) {
      console.log('No clipboard data available');
      return;
    }

    console.log('Clipboard items:', clipboardData.items.length);

    // Check for image data
    let hasImage = false;
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      console.log('Item type:', item.type);

      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          console.log('Image file found:', file.name || 'unnamed');
          uploadedImage = file;
          document.getElementById('selectedFileName').textContent = 'Pasted image';
          document.getElementById('clearImage').style.display = 'flex';
          document.getElementById('fileInfo').style.display = 'flex';
          hasImage = true;
          event.preventDefault();
          break;
        }
      }
    }

    if (hasImage) {
      showNotification('Image pasted successfully!', 'success');
    }
  } catch (error) {
    console.error('Error handling paste:', error);
  }
}
// Handle drag and drop
function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.add('drag-over');
}

function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
}

function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over');
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    // Clear any previously uploaded files
    clearSelectedImage();

    if (file.type.startsWith('image/')) {
      uploadedImage = file;
      document.getElementById('selectedFileName').textContent = file.name;
      document.getElementById('clearImage').style.display = 'flex';
      document.getElementById('fileInfo').style.display = 'flex';
    } else if (file.type === 'application/pdf') {
      handlePdfUpload(file);
    } else {
      showNotification('Please upload an image or PDF file', 'error');
    }
  }
}
// Clear selected files
function clearSelectedImage() {
  uploadedImage = null;
  uploadedPdf = null;
  pdfPageCount = 0;

  // Reset search performed flags
  window.imageSearchPerformed = false;
  window.pdfSearchPerformed = false;

  // Reset file inputs
  document.getElementById('imageUpload').value = '';
  document.getElementById('pdfUpload').value = '';

  // Reset UI elements
  document.getElementById('selectedFileName').textContent = '';
  document.getElementById('clearImage').style.display = 'none';
  document.getElementById('fileInfo').style.display = 'none';

  // Hide PDF options if they exist
  const pdfOptions = document.getElementById('pdfOptions');
  if (pdfOptions) {
    pdfOptions.style.display = 'none';
  }
}

function toggleApiVisibility(inputId) {
  const input = document.getElementById(inputId);
  const icon = event.currentTarget.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.replace('bi-eye', 'bi-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.replace('bi-eye-slash', 'bi-eye');
  }
}

function showNotification(message, type) {
  const notificationDiv = document.createElement('div');
  notificationDiv.className = `alert alert-${type === 'success' ? 'success' : 'danger'} position-fixed top-0 end-0 m-3`;
  notificationDiv.style.zIndex = '9999';
  notificationDiv.textContent = message;
  document.body.appendChild(notificationDiv);
  setTimeout(() => notificationDiv.remove(), 3000);
}

function saveApiKeys() {
  const geminiKey = document.getElementById('geminiApiKey').value;
  const wolframKey = document.getElementById('wolframAlphaApiKey').value;
  const tavilyKey = document.getElementById('tavilyApiKey').value;
  const geminiModel = document.getElementById('geminiModel').value;
  const temperature = document.getElementById('geminiTemperature').value;

  if (geminiKey || wolframKey || tavilyKey) {
    if (geminiKey) {
      localStorage.setItem('geminiApiKey', geminiKey);
      apiKeys.gemini = geminiKey;
    }
    if (wolframKey) {
      localStorage.setItem('wolframAlphaApiKey', wolframKey);
      apiKeys.wolframAlpha = wolframKey;
    }
    if (tavilyKey) {
      localStorage.setItem('tavilyApiKey', tavilyKey);
      apiKeys.tavily = tavilyKey;
    }

    // Save the selected Gemini model
    localStorage.setItem('geminiModel', geminiModel);
    apiKeys.geminiModel = geminiModel;

    // Save the temperature setting
    localStorage.setItem('geminiTemperature', temperature);
    apiKeys.temperature = parseFloat(temperature);

    // Update the Gemini model in the API service if available
    if (window.updateGeminiModel) {
      window.updateGeminiModel(geminiModel);
    }

    // Show model information in the notification
    const modelDisplayName = geminiModel.replace('gemini-', 'Gemini ').replace('-exp-03-25', '');
    const temperatureDesc = getTemperatureDescription(temperature);
    showNotification(`API settings saved successfully! Using ${modelDisplayName} with ${temperatureDesc} responses.`, 'success');
  } else {
    showNotification('Please enter at least one API key', 'error');
  }
}

// This is a duplicate function, removing it

function toggleApiConfig() {
  console.log('toggleApiConfig called');
  const apiConfigSection = document.getElementById('apiConfigSection');
  console.log('apiConfigSection:', apiConfigSection);

  // Get the computed style to check the actual display value
  const computedStyle = window.getComputedStyle(apiConfigSection);
  console.log('Current display style:', computedStyle.display);

  // Toggle display based on computed style
  if (computedStyle.display === 'none') {
    console.log('Setting display to block');
    apiConfigSection.style.display = 'block';
  } else {
    console.log('Setting display to none');
    apiConfigSection.style.display = 'none';
  }
}
// Cache for storing previous research results
const researchCache = {};
let lastSearchTimestamp = 0;
const MIN_SEARCH_INTERVAL = 2000; // 2 seconds minimum between API calls
// Helper function to read file as base64
async function fileToGenerativePart(file) {
  const base64EncodedData = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: {
      data: base64EncodedData,
      mimeType: file.type
    }
  };
}

// Process PDF for AI analysis
async function processPdf() {
  if (!uploadedPdf) return null;

  try {
    // Show processing notification
    showNotification(`Processing PDF pages ${pdfPageRange.start}-${pdfPageRange.end}...`, 'info');

    const arrayBuffer = await uploadedPdf.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;

    // Validate page range
    const start = Math.max(1, pdfPageRange.start);
    const end = Math.min(pdfPageRange.end, pdf.numPages);

    // Choose processing strategy based on mode and page count
    switch (pdfProcessingMode) {
      case 'text':
        return await extractPdfText(pdf, start, end);
      case 'visual':
        return await convertPdfPagesToImages(pdf, start, end);
      case 'intelligent':
      default:
        // For intelligent mode, use text for many pages, visual for few pages
        const pageCount = end - start + 1;
        if (pageCount > 3) {
          return await extractPdfText(pdf, start, end);
        } else {
          return await convertPdfPagesToImages(pdf, start, end);
        }
    }
  } catch (error) {
    console.error('Error processing PDF:', error);
    showNotification('Error processing PDF: ' + error.message, 'error');
    return null;
  }
}

// Extract text from PDF pages
async function extractPdfText(pdf, startPage, endPage) {
  let allText = '';

  for (let i = startPage; i <= endPage; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');

    // Add page number and separator
    allText += `--- Page ${i} ---\n${pageText}\n\n`;
  }

  return {
    type: 'text',
    content: allText,
    pageCount: endPage - startPage + 1
  };
}

// Convert PDF pages to images for visual analysis
async function convertPdfPagesToImages(pdf, startPage, endPage) {
  const images = [];
  const scale = 1.5; // Higher scale for better quality

  for (let i = startPage; i <= endPage; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    // Convert canvas to blob
    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.95);
    });

    // Create file object from blob
    const file = new File([blob], `page-${i}.jpg`, { type: 'image/jpeg' });
    images.push(file);
  }

  return {
    type: 'images',
    content: images,
    pageCount: images.length
  };
}
async function performAISearch() {
  const searchQuery = document.getElementById('searchQuery').value.trim();
  const resultsArea = document.getElementById('searchResults');
  const resultsContainer = document.querySelector('.results-area');
  const simulationContainer = document.getElementById('simulationContainer');
  const simulationProgress = document.getElementById('simulationProgress');
  const simulationControls = document.querySelector('.simulation-controls');
  const simulationFrame = document.getElementById('simulationFrame');
  const simulationReadyMessage = document.getElementById('simulationReadyMessage');

  // Reset simulation container
  if (simulationContainer) {
    simulationContainer.style.display = 'none';
    if (simulationProgress) {
      simulationProgress.style.display = 'none';
    }
    if (simulationFrame) {
      // Don't clear the iframe content, just hide it
      // This allows the simulation to persist if the user returns to it
      simulationFrame.style.display = 'none';
    }
    if (simulationReadyMessage) {
      simulationReadyMessage.style.display = 'none';
    }

    // Clear stored simulation code
    window.generatedSimulationCode = null;
  }

  if (!searchQuery && !uploadedImage && !uploadedPdf) {
    showNotification('Please enter a search query or upload an image/PDF', 'error');
    return;
  }
  if (!apiKeys.gemini && !apiKeys.wolframAlpha && !apiKeys.tavily) {
    showNotification('Please configure at least one API key', 'error');
    return;
  }

  // Show results area when search begins
  resultsContainer.style.display = 'block';

  // Make sure the toggle button is visible when results are shown
  const resultsToggleBtn = document.getElementById('resultsToggleBtn');
  if (resultsToggleBtn) {
    resultsToggleBtn.style.display = 'flex';
    // Update the icon to reflect the current state
    const icon = resultsToggleBtn.querySelector('i');
    if (icon) {
      icon.className = 'fas fa-expand-alt';
    }
  }

  // Skip cache if an image or PDF is involved
  if (!uploadedImage && !uploadedPdf && researchCache[searchQuery]) {
    console.log('Using cached result for:', searchQuery);
    // Use the search modal manager to display results
    if (window.searchModalManager) {
      window.searchModalManager.updateResults(researchCache[searchQuery]);
    } else {
      resultsArea.innerHTML = researchCache[searchQuery];
    }
    return;
  }
  // Rate limiting
  const now = Date.now();
  if (now - lastSearchTimestamp < MIN_SEARCH_INTERVAL) {
    showNotification('Please wait a moment before submitting another query', 'warning');
    return;
  }
  lastSearchTimestamp = now;

  // Start timing the research process
  const startTime = new Date();
  const timerElement = document.createElement('div');
  timerElement.id = 'researchTimer';
  timerElement.className = 'research-timer';

  // Create loading indicator with timer
  resultsArea.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"></div><p class="mt-2">Researching...</p><div id="researchTimerContainer" class="mt-1"><div class="research-timer"><i class="fas fa-clock"></i> Time elapsed: <span id="researchTimerDisplay">0s</span></div></div></div>';

  // Update the timer every second
  const timerInterval = setInterval(() => {
    const elapsedSeconds = Math.floor((new Date() - startTime) / 1000);
    const timerDisplay = document.getElementById('researchTimerDisplay');
    if (timerDisplay) {
      // Format time as MM:SS for better readability
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      timerDisplay.textContent = formattedTime;
    } else {
      clearInterval(timerInterval);
    }
  }, 1000);
  // Define modelName at a higher scope so it's available throughout the function
  const modelName = apiKeys.geminiModel || 'gemini-2.0-flash';

  let htmlOutput = '<div class="research-response mb-4">';
  try {
    // Gemini API Response
    if (apiKeys.gemini) {
      try {
        const genAI = new GoogleGenerativeAI(apiKeys.gemini);
        // Use the selected Gemini model from settings
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: apiKeys.temperature
          }
        });

        // Log the temperature being used
        console.log(`Using temperature: ${apiKeys.temperature} (${getTemperatureDescription(apiKeys.temperature)}) for research`);

        // Show which model is being used for research
        console.log(`Using Gemini model for research: ${modelName}`);
        const modelDisplayName = modelName.replace('gemini-', 'Gemini ').replace('-exp-03-25', '');
        showNotification(`Using ${modelDisplayName} for research`, 'info');

        // Prepare the results area for live streaming
        resultsArea.innerHTML = `
          <div class="gemini-response">
            <div class="response-header">
              <h3>AI Research Results</h3>
              <div class="model-badge">${modelDisplayName}</div>
            </div>
            <div class="research-progress">
              <div class="research-progress-bar"></div>
              <div class="research-status">Generating research...</div>
            </div>
            <div class="response-content" id="liveResponseContent"></div>
          </div>
        `;

        // Start the progress animation
        const progressBar = document.querySelector('.research-progress-bar');
        if (progressBar) {
          progressBar.style.width = '0%';
          let progress = 0;
          const progressInterval = setInterval(() => {
            // Gradually increase progress, but never reach 100% until complete
            if (progress < 90) {
              progress += (90 - progress) / 50;
              progressBar.style.width = `${progress}%`;
            }
          }, 100);

          // Store the interval ID to clear it later
          window.researchProgressInterval = progressInterval;
        }

        const liveResponseContent = document.getElementById('liveResponseContent');
        let geminiResponse;
        let accumulatedText = '';

        if (uploadedImage) {
          // Process image
          const imagePart = await fileToGenerativePart(uploadedImage);
          const prompt = searchQuery || "Analyze this image in detail";

          // Add prompt for LaTeX formatting
          const enhancedPrompt = `${prompt}\n\nPlease format your response professionally with proper headings, lists, and use LaTeX for any mathematical expressions (e.g., $E=mc^2$ for inline math and $$\\frac{d}{dx}f(x)$$ for display math).`;

          // Use streaming for live word generation
          const streamingResp = await model.generateContentStream({
            contents: [{
              role: "user",
              parts: [{
                text: enhancedPrompt
              }, imagePart]
            }]
          });

          // Process the stream chunks
          for await (const chunk of streamingResp.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              accumulatedText += chunkText;
              // Convert markdown to HTML on-the-fly
              liveResponseContent.innerHTML = marked.parse(accumulatedText);
              // Render LaTeX expressions
              if (window.renderMathJax) {
                window.renderMathJax(liveResponseContent);
              }
              // Scroll to bottom to show new content
              liveResponseContent.scrollTop = liveResponseContent.scrollHeight;
            }
          }

          // Get the final response
          geminiResponse = await streamingResp.response;
        } else if (uploadedPdf) {
          // Process PDF
          const pdfResult = await processPdf();
          if (!pdfResult) {
            throw new Error('Failed to process PDF');
          }

          if (pdfResult.type === 'text') {
            // For text extraction, send the text content to Gemini
            const prompt = searchQuery || "Analyze this PDF content in detail";
            const fullPrompt = `${prompt}\n\nPDF Content (${pdfResult.pageCount} pages):\n${pdfResult.content}\n\nPlease format your response professionally with proper headings, lists, and use LaTeX for any mathematical expressions (e.g., $E=mc^2$ for inline math and $$\\frac{d}{dx}f(x)$$ for display math).`;

            // Use streaming for live word generation
            const streamingResp = await model.generateContentStream(fullPrompt);

            // Process the stream chunks
            for await (const chunk of streamingResp.stream) {
              const chunkText = chunk.text();
              if (chunkText) {
                accumulatedText += chunkText;
                // Convert markdown to HTML on-the-fly
                liveResponseContent.innerHTML = marked.parse(accumulatedText);
                // Render LaTeX expressions
                if (window.renderMathJax) {
                  window.renderMathJax(liveResponseContent);
                }
                // Scroll to bottom to show new content
                liveResponseContent.scrollTop = liveResponseContent.scrollHeight;
              }
            }

            // Get the final response
            geminiResponse = await streamingResp.response;
          } else if (pdfResult.type === 'images') {
            // For visual analysis, process each page image
            let combinedResponse = '';
            const prompt = searchQuery || "Analyze this PDF page in detail";

            // Show progress notification
            showNotification(`Processing ${pdfResult.pageCount} PDF pages as images...`, 'info');

            // Add initial content
            liveResponseContent.innerHTML = `<h1>PDF Analysis (${pdfResult.pageCount} pages)</h1>`;

            // Process each page with a small delay to avoid rate limiting
            for (let i = 0; i < pdfResult.content.length; i++) {
              const pageImage = pdfResult.content[i];
              const imagePart = await fileToGenerativePart(pageImage);
              const pagePrompt = `${prompt} (Page ${pdfPageRange.start + i} of PDF)\n\nPlease format your response professionally with proper headings, lists, and use LaTeX for any mathematical expressions (e.g., $E=mc^2$ for inline math and $$\\frac{d}{dx}f(x)$$ for display math).`;

              // Update progress
              showNotification(`Processing page ${i+1} of ${pdfResult.content.length}...`, 'info');

              // Add page header to live content
              liveResponseContent.innerHTML += `<h2>Analysis of Page ${pdfPageRange.start + i}</h2>`;
              const pageContentDiv = document.createElement('div');
              pageContentDiv.id = `page-content-${i}`;
              liveResponseContent.appendChild(pageContentDiv);

              // Call Gemini API for this page with streaming
              const streamingResp = await model.generateContentStream({
                contents: [{
                  role: "user",
                  parts: [{
                    text: pagePrompt
                  }, imagePart]
                }]
              });

              let pageAccumulatedText = '';

              // Process the stream chunks
              for await (const chunk of streamingResp.stream) {
                const chunkText = chunk.text();
                if (chunkText) {
                  pageAccumulatedText += chunkText;
                  // Convert markdown to HTML on-the-fly
                  pageContentDiv.innerHTML = marked.parse(pageAccumulatedText);
                  // Render LaTeX expressions
                  if (window.renderMathJax) {
                    window.renderMathJax(pageContentDiv);
                  }
                  // Scroll to bottom to show new content
                  liveResponseContent.scrollTop = liveResponseContent.scrollHeight;
                }
              }

              // Get the page response
              const pageResponse = await streamingResp.response;
              combinedResponse += `## Analysis of Page ${pdfPageRange.start + i}\n\n${pageResponse.text()}\n\n---\n\n`;

              // Add separator
              liveResponseContent.innerHTML += '<hr>';

              // Add a small delay between API calls if there are more pages
              if (i < pdfResult.content.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }

            // Create a synthetic response object
            geminiResponse = {
              text: () => `# PDF Analysis (${pdfResult.pageCount} pages)\n\n${combinedResponse}`
            };
          }
        } else {
          // Regular text query with enhanced prompt for LaTeX
          const enhancedPrompt = `${searchQuery}\n\nPlease format your response professionally with proper headings, lists, and use LaTeX for any mathematical expressions (e.g., $E=mc^2$ for inline math and $$\\frac{d}{dx}f(x)$$ for display math).`;

          // Use streaming for live word generation
          const streamingResp = await model.generateContentStream(enhancedPrompt);

          // Process the stream chunks
          for await (const chunk of streamingResp.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              accumulatedText += chunkText;
              // Convert markdown to HTML on-the-fly
              liveResponseContent.innerHTML = marked.parse(accumulatedText);
              // Render LaTeX expressions
              if (window.renderMathJax) {
                window.renderMathJax(liveResponseContent);
              }
              // Scroll to bottom to show new content
              liveResponseContent.scrollTop = liveResponseContent.scrollHeight;
            }
          }

          // Get the final response
          geminiResponse = await streamingResp.response;
        }
        // Complete the progress bar
        if (window.researchProgressInterval) {
          clearInterval(window.researchProgressInterval);
          const progressBar = document.querySelector('.research-progress-bar');
          const statusText = document.querySelector('.research-status');
          if (progressBar) {
            progressBar.style.width = '100%';
          }
          if (statusText) {
            statusText.textContent = 'Research complete!';
          }
        }

        htmlOutput += '<h3>Gemini Response:</h3>';
        htmlOutput += marked.parse(geminiResponse.text());
        htmlOutput += '<hr>';

        // Store the final HTML output to apply MathJax after it's added to the DOM
        window.finalResearchOutput = htmlOutput;
      } catch (error) {
        console.error('Gemini API Error:', error);
        htmlOutput += '<h3>Gemini Response:</h3>';
        htmlOutput += `<div class="alert alert-warning">Error: ${error.message}</div><hr>`;
      }
    }
    // Wolfram Alpha API Response (only for text queries)
    if (apiKeys.wolframAlpha && !uploadedImage && !uploadedPdf) {
      try {
        // Use the Short Answers API with JSONP
        const script = document.createElement('script');
        const callbackName = 'wolframAlphaCallback_' + Math.random().toString(36).substr(2, 9);
        const wolframPromise = new Promise((resolve, reject) => {
          window[callbackName] = function(data) {
            delete window[callbackName]; // Clean up
            script.remove();
            resolve(data);
          };
          script.onerror = () => {
            delete window[callbackName];
            script.remove();
            reject(new Error('Failed to load Wolfram Alpha response'));
          };
        });
        script.src = `https://api.wolframalpha.com/v2/query?input=${encodeURIComponent(searchQuery)}&appid=${apiKeys.wolframAlpha}&output=json&callback=${callbackName}&podstate=Step-by-step%20solution`;
        document.body.appendChild(script);
        try {
          const data = await wolframPromise;
          htmlOutput += '<h3>Wolfram Alpha Response:</h3>';
          if (data.queryresult && data.queryresult.success) {
            let wolframText = '';
            data.queryresult.pods.forEach(pod => {
              if (pod.title && pod.subpods && pod.subpods[0].plaintext) {
                wolframText += `**${pod.title}**\n${pod.subpods[0].plaintext}\n\n`;
              }
              // If there's an image, add it
              if (pod.subpods && pod.subpods[0].img) {
                wolframText += `![${pod.title}](${pod.subpods[0].img.src})\n\n`;
              }
            });
            htmlOutput += marked.parse(wolframText);
          } else {
            htmlOutput += '<div class="alert alert-info">No results found for this query</div>';
          }
        } catch (error) {
          throw new Error('Failed to process Wolfram Alpha response');
        }
        htmlOutput += '<hr>';
      } catch (error) {
        console.error('Wolfram Alpha API Error:', error);
        htmlOutput += '<h3>Wolfram Alpha Response:</h3>';
        htmlOutput += `<div class="alert alert-warning">Error: ${error.message}. Try rephrasing your query or check your API key.</div><hr>`;
      }
    }
    // Tavily API Response (only for text queries)
    if (apiKeys.tavily && !uploadedImage && !uploadedPdf) {
      try {
        htmlOutput += '<h3>Tavily Search Results:</h3>';
        // Make a request to your server endpoint that will call Tavily API
        const response = await fetch('/api/tavily-search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: searchQuery,
            apiKey: apiKeys.tavily
          })
        });
        if (response.ok) {
          const tavilyData = await response.json();
          if (tavilyData.results && tavilyData.results.length > 0) {
            let tavilyText = '### Search Results\n\n';
            tavilyData.results.forEach((result, index) => {
              tavilyText += `**${index + 1}. [${result.title}](${result.url})**\n`;
              tavilyText += `${result.content}\n\n`;
            });
            htmlOutput += marked.parse(tavilyText);
          } else if (tavilyData.message) {
            htmlOutput += `<div class="alert alert-info">${tavilyData.message}</div>`;
          } else {
            htmlOutput += '<div class="alert alert-info">No results found for this query</div>';
          }
        } else {
          throw new Error('Failed to get response from Tavily API');
        }
        htmlOutput += '<hr>';
      } catch (error) {
        console.error('Tavily API Error:', error);
        htmlOutput += '<h3>Tavily Search Results:</h3>';
        htmlOutput += `<div class="alert alert-warning">Error: ${error.message}. Try rephrasing your query or check your API key.</div><hr>`;
      }
    }
    htmlOutput += '</div>';
    // Stop the timer
    clearInterval(timerInterval);

    // Calculate and display total research time
    const endTime = new Date();
    const totalSeconds = Math.floor((endTime - startTime) / 1000);
    // Format time consistently with the timer display
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timeDisplay = minutes > 0 ?
      `${minutes} min ${seconds} sec` :
      `${seconds} seconds`;

    // Add research time to the output with improved styling
    htmlOutput += `<div class="mt-4"><div class="research-timer"><i class="fas fa-check-circle"></i> Research completed in ${timeDisplay} using ${modelName.replace('gemini-', 'Gemini ') || 'AI'}</div></div>`;

    // Store in cache if no image or PDF was involved
    if (!uploadedImage && !uploadedPdf) {
      researchCache[searchQuery] = htmlOutput;
      const cacheKeys = Object.keys(researchCache);
      if (cacheKeys.length > 10) {
        delete researchCache[cacheKeys[0]];
      }
    }
    // Set the HTML output
    resultsArea.innerHTML = htmlOutput;

    // Apply MathJax to the final output
    setTimeout(() => {
      ensureLatexRendering();
    }, 100); // Small delay to ensure the DOM is updated
  } catch (error) {
    console.error('AI Search Error:', error);
    resultsArea.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
    showNotification('Error performing research. Please check your API keys and try again.', 'error');
  } finally {
    // Mark that a search has been performed with the current file
    // This allows the file to be used for simulation generation
    if (uploadedImage) {
      window.imageSearchPerformed = true;
    } else if (uploadedPdf) {
      window.pdfSearchPerformed = true;
    }

    // Automatically generate simulation after research is completed
    // Only do this for non-error cases and when there's a search query
    if (searchQuery && !resultsArea.innerHTML.includes('alert-danger')) {
      // Add a small delay to allow the user to see the research results first
      setTimeout(() => {
        // Show notification about auto-generating simulation
        showNotification('Automatically generating simulation based on research...', 'info');
        // Call the simulation generation function
        generateSimulation();
      }, 1500);
    }
  }
}

// Generate interactive simulation based on the current query
async function generateSimulation() {
  const searchQuery = document.getElementById('searchQuery').value.trim();
  const simulationContainer = document.getElementById('simulationContainer');
  const simulationCode = document.getElementById('simulationCode');
  const simulationFrame = document.getElementById('simulationFrame');
  const simulationProgress = document.getElementById('simulationProgress');
  const simulationProgressBar = document.getElementById('simulationProgressBar');
  const simulationProgressPercent = document.getElementById('simulationProgressPercent');
  const simulationProgressTime = document.getElementById('simulationProgressTime');
  const simulationProgressTokens = document.getElementById('simulationProgressTokens');

  if (!searchQuery && !uploadedImage && !uploadedPdf) {
    showNotification('Please enter a search query or upload an image/PDF to generate a simulation', 'error');
    return;
  }

  // Check if a search has been performed with the current image/PDF
  if ((uploadedImage && !window.imageSearchPerformed) || (uploadedPdf && !window.pdfSearchPerformed)) {
    const response = confirm('You haven\'t performed a search with the current file yet. Would you like to search first before generating a simulation?');
    if (response) {
      performAISearch();
      return;
    }
  }

  if (!apiKeys.gemini) {
    showNotification('Please configure your Gemini API key to generate simulations', 'error');
    return;
  }

  // Clear any previous simulation
  // Reset the iframe content and hide it
  simulationFrame.style.display = 'none';
  simulationFrame.srcdoc = '';

  // Clear the stored simulation code
  window.generatedSimulationCode = null;

  // Hide the ready message if it's visible
  const simulationReadyMessage = document.getElementById('simulationReadyMessage');
  if (simulationReadyMessage) {
    simulationReadyMessage.style.display = 'none';
  }

  // Show the simulation container with loading indicator
  // Use flex display if the container is expanded
  const aiContainer = document.querySelector('.ai-researcher-container.modern');
  const isExpanded = aiContainer && aiContainer.classList.contains('expanded');
  simulationContainer.style.display = isExpanded ? 'flex' : 'block';
  simulationProgress.style.display = 'block';

  // Hide the code section - we don't want to show the raw code to users
  simulationCode.style.display = 'none';

  // Add a more user-friendly loading message in the preview area
  const simulationPreview = document.getElementById('simulationPreview');
  simulationPreview.innerHTML = `
    <div class="simulation-loading">
      <div class="spinner"></div>
      <h3>Creating Your Interactive Simulation</h3>
      <p>Building an interactive experience${uploadedImage ? ' based on your image' : uploadedPdf ? ' based on your PDF' : ''} to help you understand this concept...</p>
    </div>
  `;

  // Reset progress indicators
  simulationProgressBar.style.width = '0%';
  simulationProgressPercent.textContent = '0%';
  simulationProgressTime.textContent = 'Estimating time...';
  simulationProgressTokens.textContent = '0 tokens';

  // Show/hide the image indicator based on whether an image is being used
  const simulationImageIndicator = document.getElementById('simulationImageIndicator');
  if (simulationImageIndicator) {
    simulationImageIndicator.style.display = uploadedImage ? 'flex' : 'none';
  }

  try {
    // Create the simulation prompt with image context if available
    let simulationPrompt;

    if (uploadedImage) {
      simulationPrompt = `Create an interactive HTML simulation based on this image${searchQuery ? ` and query: "${searchQuery}"` : ''}.

🎯 Goal: Build a Multi-Sensory, Step-by-Step, Interactive Simulation
Create a self-contained, realistic, and highly interactive simulation that guides users through a concept step by step, engaging multiple senses (visual, auditory, and haptic feedback). Users should understand the system by progressing through a structured learning journey while manipulating variables and observing effects.

🔍 Simulation Objectives
Deeply Understand the Concept
Before coding, simulate the real-world system mentally or on paper. Identify the core variables, dependencies, and cause-effect relationships. Think like a domain expert.

Guided Step-by-Step Discovery
Design the simulation as a series of 3-7 logical steps that build upon each other. Each step should have:
1. Clear instructions on what to do
2. Interactive elements to manipulate
3. Expected outcomes to observe
4. Multi-sensory feedback (visual, audio, haptic)
5. A way to progress to the next step

Multi-Sensory Representation
Use multiple sensory channels to enhance learning:

1. VISUAL: 3D or 4D visuals with spatial reference points (e.g., rulers, grids, force vectors)
2. AUDIO: Sound effects for interactions, narration for key concepts, and audio cues for changes
3. HAPTIC: Vibration feedback for mobile devices at key interaction points

Multiple Variable Control
Users must be able to manipulate at least 3–5 meaningful parameters (e.g., mass, angle, speed, temperature) via interactive UI. Each change should immediately reflect on-screen with corresponding audio and haptic feedback.

🧠 User Experience Guidelines
Step-by-Step Navigation
Implement a clear step navigation system with:
1. Numbered steps with descriptive titles
2. Next/Previous buttons to move between steps
3. Progress indicator showing current position in the learning journey
4. Option to jump to any step directly

Multi-Sensory Feedback
Every interaction must engage multiple senses:
1. VISUAL: Motion changes, color shifts, highlighting, animations
2. AUDIO: Sound effects for interactions, voice narration for instructions, ambient sounds
3. HAPTIC: Vibration patterns for mobile devices at key moments (using navigator.vibrate API)

Self-Explanatory Interface
Use clear, labeled UI controls (sliders, toggles, dropdowns, buttons). Add subtle tooltips or micro-copy where needed — but keep text minimal.

Real-World Behavior
The simulation must mirror real physics or logical systems, not arbitrary behaviors. If relevant, include limits, edge cases, and “failure modes” users can discover.

🛠️ Technical Specifications
Format

Deliver a single .html file with embedded JS and CSS. No external links.

Works flawlessly offline and in any modern browser (Chrome, Firefox, Safari, Edge).

Tech Stack

Use vanilla JavaScript, HTML, and CSS only. No libraries (unless absolutely necessary, e.g., three.js for essential 3D).

Ensure code is modular, readable, and includes inline comments for key functions.

Responsiveness & Compatibility

Works on both desktop and mobile.

UI should gracefully adapt to screen sizes (use relative units, media queries).

Performance

Keep it light and efficient. No unnecessary re-renders or memory leaks.

Use requestAnimationFrame for smooth animations and dynamic updates.

Test Scenarios

Simulate edge-case inputs (e.g., min/max values, rapid changes).

Make sure the simulation doesn’t break on unexpected inputs.

✨ Bonus (Optional but Ideal)
Add a "Reset" button to restore default settings.

Export user data as JSON (if applicable).

Add basic analytics: time spent interacting, variable change count (optional).

Consider including a simple pause/play button for dynamic scenes.

Implement accessibility features (keyboard navigation, screen reader support).

✅ End Result Should Be:
A guided, step-by-step learning experience that engages multiple senses

A simulation that feels like having a personal tutor guiding you through the concept

A standalone .html file that anyone can open and learn from — even offline

An experience that feels like experimenting with a real-world system while being guided through a structured learning journey

BRANDING: Include a small GPAce attribution somewhere in the UI that MUST include the text "Made by GPAce - A&A 230101017" in the corner or footer. Use the primary color #fe2c55 for this branding element. This attribution MUST be visible at all times and include both GPAce and the department/roll number.`;
    } else {
      simulationPrompt = `Create an interactive HTML simulation for this concept: "${searchQuery}"

🎯 Goal: Build a Multi-Sensory, Step-by-Step, Interactive Simulation
Create a self-contained, realistic, and highly interactive simulation that guides users through a concept step by step, engaging multiple senses (visual, auditory, and haptic feedback). Users should understand the system by progressing through a structured learning journey while manipulating variables and observing effects.

🔍 Simulation Objectives
Deeply Understand the Concept
Before coding, simulate the real-world system mentally or on paper. Identify the core variables, dependencies, and cause-effect relationships. Think like a domain expert.

Guided Step-by-Step Discovery
Design the simulation as a series of 3-7 logical steps that build upon each other. Each step should have:
1. Clear instructions on what to do
2. Interactive elements to manipulate
3. Expected outcomes to observe
4. Multi-sensory feedback (visual, audio, haptic)
5. A way to progress to the next step

Multi-Sensory Representation
Use multiple sensory channels to enhance learning:

1. VISUAL: 3D or 4D visuals with spatial reference points (e.g., rulers, grids, force vectors)
2. AUDIO: Sound effects for interactions, narration for key concepts, and audio cues for changes
3. HAPTIC: Vibration feedback for mobile devices at key interaction points

Multiple Variable Control
Users must be able to manipulate at least 3–5 meaningful parameters (e.g., mass, angle, speed, temperature) via interactive UI. Each change should immediately reflect on-screen with corresponding audio and haptic feedback.

🧠 User Experience Guidelines
Step-by-Step Navigation
Implement a clear step navigation system with:
1. Numbered steps with descriptive titles
2. Next/Previous buttons to move between steps
3. Progress indicator showing current position in the learning journey
4. Option to jump to any step directly

Multi-Sensory Feedback
Every interaction must engage multiple senses:
1. VISUAL: Motion changes, color shifts, highlighting, animations
2. AUDIO: Sound effects for interactions, voice narration for instructions, ambient sounds
3. HAPTIC: Vibration patterns for mobile devices at key moments (using navigator.vibrate API)

Self-Explanatory Interface
Use clear, labeled UI controls (sliders, toggles, dropdowns, buttons). Add subtle tooltips or micro-copy where needed — but keep text minimal.

Real-World Behavior
The simulation must mirror real physics or logical systems, not arbitrary behaviors. If relevant, include limits, edge cases, and “failure modes” users can discover.

🛠️ Technical Specifications
Format

Deliver a single .html file with embedded JS and CSS. No external links.

Works flawlessly offline and in any modern browser (Chrome, Firefox, Safari, Edge).

Tech Stack

Use vanilla JavaScript, HTML, and CSS only. No libraries (unless absolutely necessary, e.g., three.js for essential 3D).

Ensure code is modular, readable, and includes inline comments for key functions.

Responsiveness & Compatibility

Works on both desktop and mobile.

UI should gracefully adapt to screen sizes (use relative units, media queries).

Performance

Keep it light and efficient. No unnecessary re-renders or memory leaks.

Use requestAnimationFrame for smooth animations and dynamic updates.

Test Scenarios

Simulate edge-case inputs (e.g., min/max values, rapid changes).

Make sure the simulation doesn’t break on unexpected inputs.

✨ Bonus (Optional but Ideal)
Add a "Reset" button to restore default settings.

Export user data as JSON (if applicable).

Add basic analytics: time spent interacting, variable change count (optional).

Consider including a simple pause/play button for dynamic scenes.

Implement accessibility features (keyboard navigation, screen reader support).

✅ End Result Should Be:
A guided, step-by-step learning experience that engages multiple senses

A simulation that feels like having a personal tutor guiding you through the concept

A standalone .html file that anyone can open and learn from — even offline

An experience that feels like experimenting with a real-world system while being guided through a structured learning journey

BRANDING: Include a small GPAce attribution somewhere in the UI that MUST include the text "Made by GPAce - A&A 230101017" in the corner or footer. Use the primary color #fe2c55 for this branding element. This attribution MUST be visible at all times and include both GPAce and the department/roll number.`;
    }

    // Define modelName at a higher scope so it's available throughout the function
    const modelName = apiKeys.geminiModel || 'gemini-2.0-flash';

    // Initialize Gemini API
    const genAI = new GoogleGenerativeAI(apiKeys.gemini);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: apiKeys.temperature
      }
    });

    // Log the temperature being used
    console.log(`Using temperature: ${apiKeys.temperature} (${getTemperatureDescription(apiKeys.temperature)})`);

    // Show which model is being used
    console.log(`Using Gemini model: ${modelName}`);
    showNotification(`Using ${modelName.replace('gemini-', 'Gemini ')} for simulation generation`, 'info');

    // Update the model indicator in the simulation container
    const modelNameDisplay = document.getElementById('simulationModelName');
    if (modelNameDisplay) {
      // Format the model name for display
      let displayName = modelName.replace('gemini-', '');

      // Handle different model versions
      if (displayName.includes('2.5-pro-exp')) {
        displayName = '2.5 Pro';
      } else if (displayName.includes('2.0-flash')) {
        displayName = '2.0 Flash';
      } else if (displayName.includes('1.5-pro')) {
        displayName = '1.5 Pro';
      }

      modelNameDisplay.textContent = `Gemini ${displayName}`;
    }

    // Prepare for streaming response
    let prompt;

    if (uploadedImage) {
      // Convert image to format required by Gemini API
      const imagePart = await fileToGenerativePart(uploadedImage);

      prompt = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: simulationPrompt
              },
              imagePart
            ]
          }
        ]
      };
    } else if (uploadedPdf) {
      // Process PDF for simulation
      const pdfResult = await processPdf();
      if (!pdfResult) {
        throw new Error('Failed to process PDF');
      }

      if (pdfResult.type === 'text') {
        // For text extraction, send the text content to Gemini
        const fullPrompt = `${simulationPrompt}\n\nPDF Content (${pdfResult.pageCount} pages):\n${pdfResult.content}`;

        prompt = {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: fullPrompt
                }
              ]
            }
          ]
        };
      } else if (pdfResult.type === 'images') {
        // For visual analysis, use the first page image
        if (pdfResult.content.length > 0) {
          const pageImage = pdfResult.content[0]; // Use first page
          const imagePart = await fileToGenerativePart(pageImage);

          prompt = {
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `${simulationPrompt} (Based on page ${pdfPageRange.start} of PDF)`
                  },
                  imagePart
                ]
              }
            ]
          };
        } else {
          throw new Error('No PDF pages were processed');
        }
      }
    } else {
      prompt = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: simulationPrompt
              }
            ]
          }
        ]
      };
    }

    // Generate the simulation code with streaming
    const streamingResp = await model.generateContentStream(prompt);

    // Variables to track progress
    let accumulatedText = '';
    let startTime = Date.now();
    let tokenCount = 0;
    let estimatedTotalTokens = 2000; // Initial estimate, will be refined
    let lastUpdateTime = startTime;
    let generationRate = 0; // tokens per second

    // Store the code in a hidden element but don't display it
    simulationCode.innerHTML = `<pre><code></code></pre>`;
    simulationCode.style.display = 'none'; // Keep code hidden
    const codeElement = simulationCode.querySelector('code');

    // Process the stream chunks
    for await (const chunk of streamingResp.stream) {
      // Get the chunk text
      const chunkText = chunk.text();
      if (chunkText) {
        // Accumulate the text (but don't show it to the user)
        accumulatedText += chunkText;

        // Still update the hidden code element for internal use
        codeElement.textContent = escapeHtml(accumulatedText);

        // Update token count (rough estimate: ~4 chars per token)
        const newTokens = Math.ceil(chunkText.length / 4);
        tokenCount += newTokens;

        // Update progress indicators
        const currentTime = Date.now();
        const elapsedSeconds = (currentTime - startTime) / 1000;

        // Only update UI every 100ms to avoid excessive repaints
        if (currentTime - lastUpdateTime > 100) {
          // Calculate generation rate (tokens per second)
          generationRate = tokenCount / elapsedSeconds;

          // Refine the total token estimate based on generation rate and elapsed time
          if (elapsedSeconds > 2) { // Wait a bit to get a stable rate
            // Estimate total tokens based on how much we've generated and how fast
            const percentComplete = Math.min(0.95, elapsedSeconds / 30); // Assume max 30 seconds
            estimatedTotalTokens = Math.max(estimatedTotalTokens, tokenCount / percentComplete);
          }

          // Calculate progress percentage
          const progressPercent = Math.min(99, Math.floor((tokenCount / estimatedTotalTokens) * 100));

          // Update the progress bar
          simulationProgressBar.style.width = `${progressPercent}%`;
          simulationProgressPercent.textContent = `${progressPercent}%`;

          // Estimate remaining time
          const remainingTokens = estimatedTotalTokens - tokenCount;
          const remainingSeconds = generationRate > 0 ? remainingTokens / generationRate : 0;

          // Format the remaining time
          let timeText = '';
          if (remainingSeconds < 1) {
            timeText = 'Almost done...';
          } else if (remainingSeconds < 60) {
            timeText = `About ${Math.ceil(remainingSeconds)} seconds remaining`;
          } else {
            timeText = `About ${Math.floor(remainingSeconds / 60)}:${Math.floor(remainingSeconds % 60).toString().padStart(2, '0')} minutes remaining`;
          }

          simulationProgressTime.textContent = timeText;
          simulationProgressTokens.textContent = `${tokenCount} tokens generated`;

          lastUpdateTime = currentTime;
        }
      }
    }

    // Get the final response
    const response = await streamingResp.response;
    const responseText = response.text();

    // Update progress to 100%
    simulationProgressBar.style.width = '100%';
    simulationProgressPercent.textContent = '100%';
    simulationProgressTime.textContent = 'Generation complete!';
    simulationProgressTokens.textContent = `${tokenCount} tokens total`;

    // Extract code blocks from the response
    const codeBlock = extractCodeBlock(responseText);

    if (codeBlock) {
      // Store the code but keep it hidden from the user
      simulationCode.innerHTML = `<pre><code>${escapeHtml(codeBlock)}</code></pre>`;
      simulationCode.style.display = 'none'; // Keep code hidden

      // Clear the loading message from the preview area
      const simulationPreview = document.getElementById('simulationPreview');
      simulationPreview.innerHTML = '';

      // Add the simulation ready message back to the preview area
      simulationPreview.innerHTML = `
        <div id="simulationReadyMessage" class="simulation-ready-message" style="display: flex;">
          <div class="ready-icon">
            <i class="fas fa-check-circle"></i>
          </div>
          <h3>Simulation Ready!</h3>
          <p>Your interactive simulation has been generated and is ready to run.</p>
          <button id="runSimulationBtn" class="run-simulation-btn">
            <i class="fas fa-play"></i> Run Simulation
          </button>
        </div>
        <iframe id="simulationFrame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock" frameborder="0" style="display: none;"></iframe>
      `;

      // Re-attach the event listener to the new button
      document.getElementById('runSimulationBtn').addEventListener('click', runSimulation);

      // Store the code block for later use
      window.generatedSimulationCode = codeBlock;

      // Show success notification
      showNotification('Simulation generated successfully!', 'success');
    } else {
      // Show error in the preview area instead of code area
      const simulationPreview = document.getElementById('simulationPreview');
      simulationPreview.innerHTML = `<div class="alert alert-warning" style="margin: 2rem;">No valid simulation could be generated. Please try again with a different query.</div>`;
      simulationCode.style.display = 'none'; // Hide the code area
      showNotification('Failed to generate simulation. Please try again.', 'error');
    }
  } catch (error) {
    console.error('Simulation Generation Error:', error);

    // Hide the code area
    simulationCode.style.display = 'none';

    // Show error in the preview area instead
    const simulationPreview = document.getElementById('simulationPreview');
    simulationPreview.innerHTML = `<div class="alert alert-danger" style="margin: 2rem;">Error generating simulation: ${error.message}</div>`;

    showNotification('Error generating simulation. Please try again.', 'error');

    // Hide progress bar on error
    simulationProgress.style.display = 'none';
  }
}

// Extract code block from Gemini response
function extractCodeBlock(text) {
  console.log('Extracting code from response');

  // Look for code blocks with ```html or just ```
  const htmlCodeBlockRegex = /```(?:html|HTML)?([\s\S]*?)```/;
  const match = text.match(htmlCodeBlockRegex);

  if (match && match[1]) {
    let code = match[1].trim();
    console.log('Found code block with markdown syntax');

    // Clean up long base64 data
    code = cleanupBase64Data(code);

    // If the extracted code doesn't have HTML structure, wrap it
    if (!code.includes('<html') && !code.includes('<!DOCTYPE')) {
      console.log('Adding HTML wrapper to code');
      return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Interactive Simulation</title>
</head>
<body>
${code}
</body>
</html>`;
    }

    return code;
  }

  // If no code block found, check if the entire response might be HTML
  if (text.includes('<html') && text.includes('</html>')) {
    console.log('Found HTML in the entire response');
    return cleanupBase64Data(text);
  }

  // Last resort: If there's any HTML-like content, try to extract and wrap it
  if (text.includes('<') && text.includes('>')) {
    console.log('Attempting to extract HTML-like content');
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Interactive Simulation</title>
</head>
<body>
${cleanupBase64Data(text)}
</body>
</html>`;
  }

  console.log('No valid code found');
  return null;
}

// Helper function to clean up code blocks with long base64 images
function cleanupBase64Data(code) {
  // Check if the code contains very long base64 data
  if (code.includes('data:image/') && code.includes('base64,')) {
    console.log('Found base64 image data in code');

    // Find all base64 image data
    const base64Regex = /(data:image\/[^;]+;base64,[A-Za-z0-9+/=]{1000,})/g;

    // Replace very long base64 strings with a placeholder
    let modifiedCode = code.replace(base64Regex, (match) => {
      // Keep the first 100 characters of the base64 data for reference
      const shortened = match.substring(0, 100) + '...[base64 data truncated for display]';
      console.log('Truncated long base64 data in code display');
      return match; // Keep the original data for the actual simulation
    });

    return code; // Return the original code for the actual simulation
  }

  return code;
}

// Render the simulation in the iframe
function renderSimulation(code, iframe) {
  console.log('Rendering simulation in iframe');
  try {
    // First, clear any existing content
    iframe.srcdoc = '';
    iframe.removeAttribute('data-simulation-code');

    // Make sure the iframe is visible and properly sized
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.display = 'block';

    // Store the code in the iframe's srcdoc attribute for persistence
    iframe.srcdoc = code;

    // Also store in a data attribute as backup
    iframe.setAttribute('data-simulation-code', code);

    // Add a load event listener to check if the content loaded properly
    iframe.onload = function() {
      console.log('Iframe content loaded');

      try {
        // Check if the iframe has content
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const body = iframeDoc.body;

        if (body && (!body.innerHTML || body.innerHTML.trim() === '')) {
          console.warn('Iframe body is empty after loading');
          showNotification('Simulation loaded but appears to be empty. Trying again...', 'warning');

          // Try again with direct document writing as fallback
          const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
          iframeDoc.open();
          iframeDoc.write(code);
          iframeDoc.close();
        } else {
          console.log('Simulation loaded successfully');
          showNotification('Simulation loaded successfully!', 'success');
        }
      } catch (e) {
        console.error('Error checking iframe content:', e);
        // Try the fallback method
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        iframeDoc.open();
        iframeDoc.write(code);
        iframeDoc.close();
      }
    };

    // Add error handling
    iframe.onerror = function(e) {
      console.error('Iframe error:', e);
      showNotification('Error loading simulation. Trying alternative method...', 'warning');

      // Try direct document writing as fallback
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        iframeDoc.open();
        iframeDoc.write(code);
        iframeDoc.close();
      } catch (err) {
        console.error('Fallback loading failed:', err);
        showNotification('Could not load simulation. Please try regenerating.', 'error');
      }
    };
  } catch (error) {
    console.error('Error rendering simulation:', error);
    showNotification('Error rendering simulation. Please check the console for details.', 'error');
  }
}

// Copy simulation code to clipboard
function copySimulationCode() {
  const simulationCode = document.getElementById('simulationCode');
  const codeElement = simulationCode.querySelector('code');

  if (codeElement) {
    const code = codeElement.textContent;
    navigator.clipboard.writeText(code)
      .then(() => {
        showNotification('Simulation code copied to clipboard!', 'success');
      })
      .catch(err => {
        console.error('Failed to copy code:', err);
        showNotification('Failed to copy code. Please try again.', 'error');
      });
  }
}

// Download simulation as HTML file with GPAce credits and embedded libraries
function downloadSimulation() {
  if (!window.generatedSimulationCode) {
    showNotification('No simulation to download. Please generate one first.', 'error');
    return;
  }

  try {
    // Show processing notification
    showNotification('Processing simulation for download...', 'info');

    // Parse the HTML code
    const parser = new DOMParser();
    const simulationDoc = parser.parseFromString(window.generatedSimulationCode, 'text/html');

    // Create a more visible GPAce watermark with logo

    // First, create a base64 encoded version of the GPAce logo
    // This is a simplified white logo that will work in the watermark
    const gpaceLogoBase64 = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNNTAgMTBDMjcuOTEgMTAgMTAgMjcuOTEgMTAgNTBzMTcuOTEgNDAgNDAgNDBjMTMuNDUgMCAxMC0yMCAxMC0yMGgtMTBjMCAwIDAgMTAgLTEwIDEwYy0xNi41NyAwLTMwLTEzLjQzLTMwLTMwczEzLjQzLTMwIDMwLTMwYzEwIDAgMTAgMTAgMTAgMTBoMTBjMCAwIDMuNDUtMjAtMTAtMjB6Ij48L3BhdGg+PHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0iTTcwIDQwSDUwdjIwaDIwVjQweiI+PC9wYXRoPjwvc3ZnPg==';

    // Create a watermark container element
    const watermarkDiv = simulationDoc.createElement('div');
    watermarkDiv.id = 'gpace-watermark';

    // Add the watermark style
    const watermarkStyle = simulationDoc.createElement('style');
    watermarkStyle.textContent = `
      #gpace-watermark {
        position: fixed;
        bottom: 10px;
        right: 10px;
        display: flex;
        align-items: center;
        background-color: rgba(30, 30, 30, 0.8);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-family: Arial, sans-serif;
        font-size: 12px;
        z-index: 9999;
        pointer-events: none;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(2px);
      }

      #gpace-watermark img {
        width: 24px;
        height: 24px;
        margin-right: 8px;
      }

      #gpace-watermark .gpace-text {
        display: flex;
        flex-direction: column;
      }

      #gpace-watermark .gpace-title {
        font-weight: bold;
        font-size: 13px;
        color: #fe2c55;
      }

      #gpace-watermark .gpace-subtitle {
        font-size: 10px;
        opacity: 0.8;
      }
    `;

    // Add the watermark HTML
    watermarkDiv.innerHTML = `
      <img src="${gpaceLogoBase64}" alt="GPAce Logo">
      <div class="gpace-text">
        <span class="gpace-title">Made by GPAce</span>
        <span class="gpace-subtitle">Beta v1 · Launch Sep 2025 · A&A 230101017</span>
      </div>
    `;

    // Add the style to the head
    simulationDoc.head.appendChild(watermarkStyle);

    // Add the watermark to the body
    simulationDoc.body.appendChild(watermarkDiv);

    // Process external scripts to make them work offline
    const scripts = simulationDoc.querySelectorAll('script[src]');
    const scriptPromises = [];

    // Create a map of common libraries and their fallback URLs
    const commonLibraries = {
      'three.js': 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js',
      'three.min.js': 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js',
      'OrbitControls.js': 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/controls/OrbitControls.js',
      'p5.js': 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js',
      'p5.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js',
      'chart.js': 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
      'chart.min.js': 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
      // Add specific mappings for Three.js addons that might be used incorrectly
      'BufferGeometryUtils.js': 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/utils/BufferGeometryUtils.js',
      'GLTFLoader.js': 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/loaders/GLTFLoader.js',
      'FBXLoader.js': 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/loaders/FBXLoader.js',
      'OBJLoader.js': 'https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/loaders/OBJLoader.js'
    };

    // Function to fetch script content
    const fetchScript = async (script) => {
      const src = script.getAttribute('src');

      // Skip if it's a data URL (already embedded)
      if (src.startsWith('data:')) {
        return;
      }

      try {
        // Determine the URL to fetch from
        let fetchUrl = src;

        // If it's a relative URL without http/https, try to use a known CDN fallback
        if (!src.startsWith('http')) {
          // Extract the filename from the path
          const filename = src.split('/').pop().toLowerCase();

          // Check if we have a fallback for this library
          for (const [libName, libUrl] of Object.entries(commonLibraries)) {
            if (filename.includes(libName.toLowerCase())) {
              fetchUrl = libUrl;
              break;
            }
          }
        }

        // Fetch the script content
        const response = await fetch(fetchUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch script: ${fetchUrl}`);
        }

        const content = await response.text();

        // Create a new inline script with the content
        const inlineScript = simulationDoc.createElement('script');
        inlineScript.textContent = content;

        // Copy attributes except src
        Array.from(script.attributes).forEach(attr => {
          if (attr.name !== 'src') {
            inlineScript.setAttribute(attr.name, attr.value);
          }
        });

        // Replace the external script with the inline one
        script.parentNode.replaceChild(inlineScript, script);
      } catch (error) {
        console.error(`Error embedding script ${src}:`, error);
        // Keep the original script as fallback
      }
    };

    // Process all scripts
    scripts.forEach(script => {
      scriptPromises.push(fetchScript(script));
    });

    // Process external stylesheets
    const stylesheets = simulationDoc.querySelectorAll('link[rel="stylesheet"]');
    const stylePromises = [];

    const fetchStylesheet = async (stylesheet) => {
      const href = stylesheet.getAttribute('href');

      // Skip if it's a data URL
      if (href.startsWith('data:')) {
        return;
      }

      try {
        // Fetch the stylesheet content
        const response = await fetch(href);
        if (!response.ok) {
          throw new Error(`Failed to fetch stylesheet: ${href}`);
        }

        const content = await response.text();

        // Create a new style element with the content
        const inlineStyle = simulationDoc.createElement('style');
        inlineStyle.textContent = content;

        // Replace the external stylesheet with the inline one
        stylesheet.parentNode.replaceChild(inlineStyle, stylesheet);
      } catch (error) {
        console.error(`Error embedding stylesheet ${href}:`, error);
        // Keep the original stylesheet as fallback
      }
    };

    // Process all stylesheets
    stylesheets.forEach(stylesheet => {
      stylePromises.push(fetchStylesheet(stylesheet));
    });

    // Function to fix common Three.js import errors in the HTML content
    const fixThreeJsImports = (htmlContent) => {
      // Replace ES module imports with script tags
      let fixedContent = htmlContent;

      // Fix import statements for Three.js
      const importRegex = /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"](three|three\/addons\/[^'"]+)['"];?/g;
      fixedContent = fixedContent.replace(importRegex, (match, imports, path) => {
        // If it's importing from 'three', we already have the main Three.js library
        if (path === 'three') {
          return '// Three.js objects are available globally through the THREE object';
        }

        // If it's importing from three/addons, we need to add the appropriate script
        if (path.startsWith('three/addons/')) {
          const addonPath = path.replace('three/addons/', '');
          const scriptPath = `https://cdn.jsdelivr.net/npm/three@0.159.0/examples/js/${addonPath}`;
          return `// Using ${scriptPath} instead of ES module import\n// Access through THREE.${imports.split(',').map(i => i.trim()).join(', THREE.')}`;
        }

        return match; // Keep other imports unchanged
      });

      // Fix BufferGeometryUtils specific issue
      fixedContent = fixedContent.replace(
        /import\s+\{\s*BufferGeometryUtils\s*\}\s+from\s+['"](three\/addons\/utils\/BufferGeometryUtils\.js)['"];?/g,
        '// BufferGeometryUtils is available through THREE.BufferGeometryUtils'
      );

      // Replace any remaining ES module usage patterns
      fixedContent = fixedContent.replace(
        /const\s+\{\s*([^}]+)\s*\}\s*=\s*THREE;/g,
        (match, objects) => {
          const objArray = objects.split(',').map(o => o.trim());
          return objArray.map(obj => `const ${obj} = THREE.${obj};`).join('\n');
        }
      );

      return fixedContent;
    };

    // Wait for all resources to be processed
    Promise.all([...scriptPromises, ...stylePromises]).then(() => {
      // Get the HTML content
      let modifiedHtml = simulationDoc.documentElement.outerHTML;

      // Fix any Three.js import issues
      modifiedHtml = fixThreeJsImports(modifiedHtml);

      // Create a blob with the fixed HTML
      const blob = new Blob([modifiedHtml], { type: 'text/html' });

      // Create a download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      // Generate a filename based on the current date and search query
      const searchQuery = document.getElementById('searchQuery').value.trim();
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const filename = `GPAce_Simulation_${searchQuery.substring(0, 30).replace(/[^a-z0-9]/gi, '_')}_${dateStr}.html`;

      link.download = filename;
      document.body.appendChild(link);

      // Trigger download
      link.click();

      // Clean up
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotification('Simulation downloaded with embedded libraries', 'success');
    }).catch(error => {
      console.error('Error processing resources:', error);
      showNotification('Error embedding resources. Downloading with external dependencies.', 'warning');

      // Fallback to downloading without embedding resources
      let modifiedHtml = simulationDoc.documentElement.outerHTML;

      // Still fix any Three.js import issues
      modifiedHtml = fixThreeJsImports(modifiedHtml);

      const blob = new Blob([modifiedHtml], { type: 'text/html' });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const searchQuery = document.getElementById('searchQuery').value.trim();
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const filename = `GPAce_Simulation_${searchQuery.substring(0, 30).replace(/[^a-z0-9]/gi, '_')}_${dateStr}.html`;

      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  } catch (error) {
    console.error('Error downloading simulation:', error);
    showNotification('Error downloading simulation. Please try again.', 'error');
  }
}

// Close the simulation container
function closeSimulation() {
  const simulationContainer = document.getElementById('simulationContainer');
  const simulationProgress = document.getElementById('simulationProgress');
  const simulationFrame = document.getElementById('simulationFrame');
  const simulationReadyMessage = document.getElementById('simulationReadyMessage');

  // Hide all simulation elements
  simulationContainer.style.display = 'none';
  simulationProgress.style.display = 'none';
  if (simulationReadyMessage) {
    simulationReadyMessage.style.display = 'none';
  }

  // Don't hide the iframe or clear its content - just hide the container
  // This ensures the simulation persists if the user reopens it
  // We'll keep the simulation code in memory and in the iframe's data attribute
}

// Run the generated simulation
function runSimulation() {
  const simulationFrame = document.getElementById('simulationFrame');
  const simulationReadyMessage = document.getElementById('simulationReadyMessage');
  const simulationContainer = document.getElementById('simulationContainer');

  // Hide the ready message
  if (simulationReadyMessage) {
    simulationReadyMessage.style.display = 'none';
  }

  // First, clear any existing content to ensure we start fresh
  simulationFrame.srcdoc = '';

  // Show the iframe
  simulationFrame.style.display = 'block';

  // Make sure the simulation container is visible
  if (simulationContainer) {
    // Check if we're in expanded mode
    const aiContainer = document.querySelector('.ai-researcher-container.modern');
    const isExpanded = aiContainer && aiContainer.classList.contains('expanded');
    simulationContainer.style.display = isExpanded ? 'flex' : 'block';
  }

  // Always use the latest generated code from memory
  if (window.generatedSimulationCode) {
    // Render the simulation using the code in memory
    console.log('Rendering simulation from memory');
    renderSimulation(window.generatedSimulationCode, simulationFrame);
    showNotification('Simulation is now running!', 'success');
  } else {
    // No simulation code found
    showNotification('No simulation code found. Please regenerate.', 'error');
  }
}

// Helper function to escape HTML for safe display
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Function to ensure LaTeX is properly rendered in the final output
function ensureLatexRendering() {
  // Find all elements that might contain LaTeX
  const resultsArea = document.getElementById('searchResults');
  if (!resultsArea) return;

  // Apply MathJax to the entire results area
  if (window.renderMathJax) {
    window.renderMathJax(resultsArea);
  }
}

// Toggle AI container expansion
function toggleResultsExpansion() {
  const aiContainer = document.querySelector('.ai-researcher-container.modern');
  if (aiContainer) {
    // Check current state
    const wasExpanded = aiContainer.classList.contains('expanded');

    // Toggle the expanded class
    aiContainer.classList.toggle('expanded');

    // Get the new state
    const isExpanded = aiContainer.classList.contains('expanded');

    console.log('AI container expansion toggled:', isExpanded ? 'expanded' : 'collapsed');

    // Update the icon based on the expanded state
    const resultsToggleBtn = document.getElementById('resultsToggleBtn');
    if (resultsToggleBtn) {
      const icon = resultsToggleBtn.querySelector('i');
      if (icon) {
        icon.className = isExpanded ? 'fas fa-compress-alt' : 'fas fa-expand-alt';
      }
      // Update the title for accessibility
      resultsToggleBtn.title = isExpanded ? 'Collapse AI Container' : 'Expand AI Container';
    }

    // If expanded, make sure the content is visible by scrolling to it
    if (isExpanded) {
      // Scroll to top of page when expanded
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Hide the AI container toggle button when expanded
      const aiContainerToggle = document.getElementById('aiContainerToggle');
      if (aiContainerToggle) {
        aiContainerToggle.style.display = 'none';
      }

      // Make sure the simulation container is visible if it exists
      const simulationContainer = document.getElementById('simulationContainer');
      if (simulationContainer) {
        // Check if we have a simulation code or if the simulation is already visible
        if (window.generatedSimulationCode || simulationContainer.style.display === 'block') {
          simulationContainer.style.display = 'flex';
          console.log('Showing simulation container in expanded mode');

          // Make sure the simulation frame is visible
          const simulationFrame = document.getElementById('simulationFrame');
          if (simulationFrame) {
            simulationFrame.style.display = 'block';
          }

          // Make sure the simulation preview is visible
          const simulationPreview = document.getElementById('simulationPreview');
          if (simulationPreview) {
            simulationPreview.style.display = 'flex';
          }
        }
      }
    } else {
      // Show the AI container toggle button when collapsed
      const aiContainerToggle = document.getElementById('aiContainerToggle');
      if (aiContainerToggle) {
        aiContainerToggle.style.display = 'flex';
      }
    }
  }
}

// Function to toggle AI container visibility
function toggleAIContainer() {
  const aiContainer = document.querySelector('.ai-researcher-container');
  const toggleButton = document.getElementById('aiContainerToggle');

  if (aiContainer) {
    aiContainer.classList.toggle('hidden');

    // Save state to localStorage
    const isHidden = aiContainer.classList.contains('hidden');
    localStorage.setItem('ai-container-hidden', isHidden);

    // Update button position when container is hidden/shown
    if (isHidden) {
      toggleButton.style.bottom = '20px';
    } else {
      // Check if container has modern class
      if (aiContainer.classList.contains('modern')) {
        toggleButton.style.bottom = '6rem';
      } else {
        toggleButton.style.bottom = '18.5rem';
      }
    }

    // Announce to screen readers
    const message = isHidden ? 'AI container hidden' : 'AI container visible';
    showNotification(message, 'info');
  }
}

// Function to copy search results to clipboard
async function copySearchResults() {
  const resultsArea = document.getElementById('searchResults');
  if (!resultsArea || !resultsArea.innerHTML.trim()) {
    showNotification('No results to copy', 'warning');
    return;
  }

  try {
    // Get the text content from the results area
    const textContent = resultsArea.innerText;

    // Copy to clipboard
    await navigator.clipboard.writeText(textContent);
    showNotification('Results copied to clipboard', 'success');
  } catch (error) {
    console.error('Error copying results:', error);
    showNotification('Failed to copy results', 'error');
  }
}

// Function to download search results as PDF
function downloadSearchResultsAsPdf() {
  const resultsArea = document.getElementById('searchResults');
  if (!resultsArea || !resultsArea.innerHTML.trim()) {
    showNotification('No results to download', 'warning');
    return;
  }

  try {
    // Make sure LaTeX is properly rendered
    ensureLatexRendering();

    // Create a new window for PDF generation
    const printWindow = window.open('', '_blank');

    // Add GPAce branding
    const currentDate = new Date().toLocaleDateString();
    const searchQuery = document.getElementById('searchQuery').value.trim() || 'AI Research';

    // Create HTML content for the PDF
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GPAce - ${searchQuery}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 40px;
            line-height: 1.6;
            color: #333;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ddd;
          }
          .branding {
            display: flex;
            align-items: center;
          }
          .branding img {
            height: 40px;
            margin-right: 10px;
          }
          .content {
            margin-bottom: 30px;
          }
          .footer {
            margin-top: 30px;
            padding-top: 10px;
            border-top: 1px solid #ddd;
            font-size: 12px;
            color: #777;
            text-align: center;
          }
          h1, h2, h3 { color: #444; }
          pre, code {
            background-color: #f5f5f5;
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
          }
          img { max-width: 100%; }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 15px 0;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="branding">
            <img src="assets/images/gpace-logo-white.png" alt="GPAce Logo">
            <h1>GPAce Research</h1>
          </div>
          <div class="date">${currentDate}</div>
        </div>
        <h2>${searchQuery}</h2>
        <div class="content">
          ${resultsArea.innerHTML}
        </div>
        <div class="footer">
          Generated by GPAce Beta v1 | Launch in September 2025 for Students | Made by A&A 230101017
        </div>
      </body>
      </html>
    `);

    // Close the document for writing
    printWindow.document.close();

    // Wait for content to load then print
    printWindow.onload = () => {
      try {
        printWindow.print();
        showNotification('PDF export ready', 'success');
      } catch (error) {
        console.error('Error printing document:', error);
        showNotification('Error exporting to PDF', 'error');
      }
    };
  } catch (error) {
    console.error('Error generating PDF:', error);
    showNotification('Error generating PDF', 'error');
  }
}

// Make functions available globally
window.toggleApiVisibility = toggleApiVisibility;
window.saveApiKeys = saveApiKeys;
window.performAISearch = performAISearch;
window.toggleApiConfig = toggleApiConfig;
window.clearSelectedImage = clearSelectedImage;
window.toggleResultsExpansion = toggleResultsExpansion;
window.generateSimulation = generateSimulation;
window.copySimulationCode = copySimulationCode;
window.closeSimulation = closeSimulation;
window.toggleAIContainer = toggleAIContainer;
window.copySearchResults = copySearchResults;
window.downloadSearchResultsAsPdf = downloadSearchResultsAsPdf;
// Load saved API key on page load
document.addEventListener('DOMContentLoaded', function() {
  // Initialize search performed flags
  window.imageSearchPerformed = false;
  window.pdfSearchPerformed = false;

  // Add click event for the close buttons on expanded elements
  document.addEventListener('click', function(e) {
    // Check if the click was on the close button for the AI container (::after pseudo-element)
    const expandedContainer = document.querySelector('.ai-researcher-container.modern.expanded');
    if (expandedContainer) {
      // Calculate position of the close button
      const rect = expandedContainer.getBoundingClientRect();
      const closeButtonX = rect.right - 30; // Approximate X position of close button
      const closeButtonY = rect.top + 30;   // Approximate Y position of close button

      // Check if click was within close button area
      if (Math.abs(e.clientX - closeButtonX) < 20 && Math.abs(e.clientY - closeButtonY) < 20) {
        toggleResultsExpansion();
      }
    }
  });

  const savedGeminiKey = localStorage.getItem('geminiApiKey');
  const savedWolframKey = localStorage.getItem('wolframAlphaApiKey');
  const savedTavilyKey = localStorage.getItem('tavilyApiKey');
  const savedGeminiModel = localStorage.getItem('geminiModel');

  // Restore AI container visibility state
  const aiContainerHidden = localStorage.getItem('ai-container-hidden') === 'true';
  const aiContainer = document.querySelector('.ai-researcher-container');
  const aiContainerToggle = document.getElementById('aiContainerToggle');

  if (aiContainer && aiContainerToggle) {
    // Set initial button position based on container type
    if (aiContainer.classList.contains('modern')) {
      aiContainerToggle.style.bottom = '6rem';
    } else {
      aiContainerToggle.style.bottom = '18.5rem';
    }

    // Apply hidden state if needed
    if (aiContainerHidden) {
      aiContainer.classList.add('hidden');
      aiContainerToggle.style.bottom = '20px';
    }
  }

  // Add event listener to the AI container toggle button
  if (aiContainerToggle) {
    aiContainerToggle.addEventListener('click', toggleAIContainer);
  }

  if (savedGeminiKey) {
    document.getElementById('geminiApiKey').value = savedGeminiKey;
    apiKeys.gemini = savedGeminiKey;
  }
  if (savedWolframKey) {
    document.getElementById('wolframAlphaApiKey').value = savedWolframKey;
    apiKeys.wolframAlpha = savedWolframKey;
  }
  if (savedTavilyKey) {
    document.getElementById('tavilyApiKey').value = savedTavilyKey;
    apiKeys.tavily = savedTavilyKey;
  }
  if (savedGeminiModel) {
    document.getElementById('geminiModel').value = savedGeminiModel;
    apiKeys.geminiModel = savedGeminiModel;
  }

  // Initialize temperature slider
  const savedTemperature = localStorage.getItem('geminiTemperature');
  if (savedTemperature) {
    const temperatureSlider = document.getElementById('geminiTemperature');
    if (temperatureSlider) {
      temperatureSlider.value = savedTemperature;
      updateTemperatureDisplay(savedTemperature);
    }
  }

  // Add event listener for temperature slider
  const temperatureSlider = document.getElementById('geminiTemperature');
  if (temperatureSlider) {
    temperatureSlider.addEventListener('input', function() {
      updateTemperatureDisplay(this.value);
    });
  }
  // Add click event listener for API config toggle
  document.getElementById('toggleApiConfig').addEventListener('click', toggleApiConfig);
  // Add event listeners for file uploads
  const imageUpload = document.getElementById('imageUpload');
  const pdfUpload = document.getElementById('pdfUpload');
  const searchQuery = document.getElementById('searchQuery');
  const searchInterface = document.querySelector('.search-interface');
  imageUpload.addEventListener('change', handleFileSelect);
  pdfUpload.addEventListener('change', handleFileSelect);
  // Add paste event listener to search query input
  if (searchQuery) {
    console.log('Adding paste event listener to search query input');
    searchQuery.addEventListener('paste', handlePaste);
    // Also add it to the entire search interface for better coverage
    searchInterface.addEventListener('paste', handlePaste);
  } else {
    console.error('Search query input not found');
  }
  // Add drag and drop event listeners
  searchInterface.addEventListener('dragover', handleDragOver);
  searchInterface.addEventListener('dragleave', handleDragLeave);
  searchInterface.addEventListener('drop', handleDrop);
  document.getElementById('clearImage').addEventListener('click', clearSelectedImage);

  // Set up results toggle button
  const resultsToggleBtn = document.getElementById('resultsToggleBtn');
  if (resultsToggleBtn) {
    resultsToggleBtn.addEventListener('click', toggleResultsExpansion);
  }

  // Set up simulation buttons
  const generateSimulationBtn = document.getElementById('generateSimulationBtn');
  if (generateSimulationBtn) {
    generateSimulationBtn.addEventListener('click', generateSimulation);
  }

  const copySimulationCodeBtn = document.getElementById('copySimulationCode');
  if (copySimulationCodeBtn) {
    copySimulationCodeBtn.addEventListener('click', copySimulationCode);
  }

  // Set up copy and download buttons for search results
  const copyResultsBtn = document.getElementById('copyResultsBtn');
  if (copyResultsBtn) {
    copyResultsBtn.addEventListener('click', copySearchResults);
  }

  const downloadResultsPdfBtn = document.getElementById('downloadResultsPdfBtn');
  if (downloadResultsPdfBtn) {
    downloadResultsPdfBtn.addEventListener('click', downloadSearchResultsAsPdf);
  }

  // Set up text-to-speech buttons
  const speakResultsBtn = document.getElementById('speakResultsBtn');
  if (speakResultsBtn) {
    speakResultsBtn.addEventListener('click', speakSearchResults);
  }

  const pauseResumeTextToSpeechBtn = document.getElementById('pauseResumeTextToSpeechBtn');
  if (pauseResumeTextToSpeechBtn) {
    pauseResumeTextToSpeechBtn.addEventListener('click', pauseResumeTextToSpeech);
  }

  const stopTextToSpeechBtn = document.getElementById('stopTextToSpeechBtn');
  if (stopTextToSpeechBtn) {
    stopTextToSpeechBtn.addEventListener('click', stopTextToSpeech);
  }

  const downloadSimulationBtn = document.getElementById('downloadSimulation');
  if (downloadSimulationBtn) {
    downloadSimulationBtn.addEventListener('click', downloadSimulation);
  }

  const closeSimulationBtn = document.getElementById('closeSimulation');
  if (closeSimulationBtn) {
    closeSimulationBtn.addEventListener('click', closeSimulation);
  }

  const reloadSimulationBtn = document.getElementById('reloadSimulation');
  if (reloadSimulationBtn) {
    reloadSimulationBtn.addEventListener('click', function() {
      // Show confirmation dialog before regenerating simulation
      const confirmRedo = confirm('Are you sure you want to regenerate the simulation? This will replace the current simulation.');
      if (confirmRedo) {
        generateSimulation();
      }
    });
  }

  const runSimulationBtn = document.getElementById('runSimulationBtn');
  if (runSimulationBtn) {
    runSimulationBtn.addEventListener('click', runSimulation);
  }

  // Make sure the simulation button is visible when search results are shown
  const performSearchOriginal = window.performAISearch;
  window.performAISearch = function() {
    performSearchOriginal.apply(this, arguments);
    // Make sure the simulation controls are visible
    setTimeout(() => {
      const resultsContainer = document.querySelector('.results-area');
      if (resultsContainer && resultsContainer.style.display !== 'none') {
        const simulationControls = document.querySelector('.simulation-controls');
        if (simulationControls) {
          simulationControls.style.display = 'flex';
        }
      }
    }, 500);
  };
});
// Add event listener for Enter key in search textarea
document.getElementById('searchQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    performAISearch();
  }
});

// Add global keyboard shortcut for toggling AI container (Alt+A)
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'a') {
    e.preventDefault();
    toggleAIContainer();
  }
  // Add keyboard shortcut for opening snippet manager (Alt+S)
  if (e.altKey && e.key === 's') {
    e.preventDefault();
    if (window.textExpansionManager) {
      window.textExpansionManager.showSnippetManager();
    }
  }
});
