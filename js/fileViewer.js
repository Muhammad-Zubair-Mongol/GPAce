/**
 * File Viewer Component
 * Handles rendering of different file types in task attachments
 */

class FileViewer {
    constructor() {
        this.pdfJsLoaded = false;
        this.pdfjs = null;
        this.currentZoom = 1;
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.translateX = 0;
        this.translateY = 0;
        
        // Bind methods
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
    }

    /**
     * Initialize PDF.js library if needed
     */
    async initPdfJs() {
        if (this.pdfJsLoaded) return;
        
        // Load PDF.js scripts
        await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
        await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');
        
        // Set worker source
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        
        this.pdfjs = window.pdfjsLib;
        this.pdfJsLoaded = true;
    }

    /**
     * Load a script dynamically
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Determine handler based on file type
     */
    getHandlerForFile(file) {
        const mimeType = file.mimeType || '';
        
        if (mimeType.startsWith('image/')) {
            return this.renderImage;
        } else if (mimeType === 'application/pdf') {
            return this.renderPdf;
        } else if (mimeType.includes('spreadsheet') || mimeType.includes('sheet')) {
            return this.renderSpreadsheet;
        } else if (mimeType.includes('document') || mimeType.includes('word')) {
            return this.renderDocument;
        } else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
            return this.renderPresentation;
        } else {
            return this.renderGenericFile;
        }
    }

    /**
     * Render file preview in container
     */
    async renderFile(file, container) {
        try {
            const handler = this.getHandlerForFile(file);
            await handler.call(this, file, container);
        } catch (error) {
            console.error('Error rendering file:', error);
            container.innerHTML = `
                <div class="file-error">
                    <div class="file-error-icon">⚠️</div>
                    <div class="file-error-message">Error displaying file</div>
                    <a href="${file.webContentLink}" target="_blank" class="btn btn-sm btn-primary mt-2">
                        Download File
                    </a>
                </div>
            `;
        }
    }

    /**
     * Add zoom controls to preview container
     */
    addZoomControls(container, contentElement, type = 'image') {
        const toolbar = document.createElement('div');
        toolbar.className = 'file-preview-toolbar';
        toolbar.innerHTML = `
            <button class="preview-tool-button zoom-out" title="Zoom Out">
                <i class="bi bi-zoom-out"></i>
            </button>
            <span class="preview-zoom-level">100%</span>
            <button class="preview-tool-button zoom-in" title="Zoom In">
                <i class="bi bi-zoom-in"></i>
            </button>
            <button class="preview-tool-button reset-zoom" title="Reset">
                <i class="bi bi-arrow-counterclockwise"></i>
            </button>
        `;
        
        container.appendChild(toolbar);
        
        const zoomLevel = toolbar.querySelector('.preview-zoom-level');
        const updateZoomLevel = () => {
            zoomLevel.textContent = `${Math.round(this.currentZoom * 100)}%`;
            contentElement.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.currentZoom})`;
        };
        
        // Zoom controls
        toolbar.querySelector('.zoom-in').addEventListener('click', () => {
            this.currentZoom = Math.min(this.currentZoom * 1.2, 5);
            updateZoomLevel();
        });
        
        toolbar.querySelector('.zoom-out').addEventListener('click', () => {
            this.currentZoom = Math.max(this.currentZoom / 1.2, 0.5);
            updateZoomLevel();
        });
        
        toolbar.querySelector('.reset-zoom').addEventListener('click', () => {
            this.currentZoom = 1;
            this.translateX = 0;
            this.translateY = 0;
            updateZoomLevel();
        });
        
        // Pan controls for zoomed content
        const wrapper = type === 'image' ? contentElement.parentElement : container;
        
        const startDrag = (e) => {
            if (this.currentZoom <= 1) return;
            
            this.isDragging = true;
            wrapper.classList.add('zoomed');
            
            if (e.type === 'mousedown') {
                this.startX = e.clientX - this.translateX;
                this.startY = e.clientY - this.translateY;
            } else if (e.type === 'touchstart') {
                this.startX = e.touches[0].clientX - this.translateX;
                this.startY = e.touches[0].clientY - this.translateY;
            }
        };
        
        const drag = (e) => {
            if (!this.isDragging) return;
            
            e.preventDefault();
            
            const clientX = e.type === 'mousemove' ? e.clientX : e.touches[0].clientX;
            const clientY = e.type === 'mousemove' ? e.clientY : e.touches[0].clientY;
            
            this.translateX = clientX - this.startX;
            this.translateY = clientY - this.startY;
            
            updateZoomLevel();
        };
        
        const endDrag = () => {
            this.isDragging = false;
            wrapper.classList.remove('zoomed');
        };
        
        // Mouse events
        wrapper.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', endDrag);
        
        // Touch events
        wrapper.addEventListener('touchstart', startDrag);
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('touchend', endDrag);
        
        // Wheel zoom
        wrapper.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;
            
            e.preventDefault();
            
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.currentZoom = Math.max(0.5, Math.min(5, this.currentZoom * delta));
            
            updateZoomLevel();
        });
        
        return updateZoomLevel;
    }
    
    /**
     * Handle keyboard navigation
     */
    handleKeyDown(e, container) {
        if (e.key === 'Escape') {
            const modal = container.closest('.file-preview-modal');
            if (modal) {
                modal.classList.remove('show');
            }
        }
    }
    
    /**
     * Handle mouse wheel zoom
     */
    handleWheel(e, updateZoom) {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.currentZoom = Math.max(0.5, Math.min(5, this.currentZoom * delta));
            updateZoom();
        }
    }

    /**
     * Render image file
     */
    renderImage(file, container) {
        container.innerHTML = `
            <div class="image-preview">
                <img src="${file.webContentLink}" alt="${file.name}">
            </div>
        `;
        
        const img = container.querySelector('img');
        const updateZoom = this.addZoomControls(container, img, 'image');
        
        // Reset zoom when loading new image
        this.currentZoom = 1;
        this.translateX = 0;
        this.translateY = 0;
        updateZoom();
        
        // Add keyboard navigation
        document.addEventListener('keydown', (e) => this.handleKeyDown(e, container));
    }

    /**
     * Render PDF file
     */
    async renderPdf(file, container) {
        await this.initPdfJs();
        
        // Create canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'pdf-preview';
        container.innerHTML = '';
        container.appendChild(canvasContainer);
        
        // Load PDF
        const pdfDoc = await this.pdfjs.getDocument(file.webContentLink).promise;
        const totalPages = pdfDoc.numPages;
        let currentPage = 1;
        
        // Add navigation toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'file-preview-toolbar';
        toolbar.style.width = 'auto'; // Override default width for PDF toolbar
        toolbar.innerHTML = `
            <button class="preview-tool-button pdf-prev" title="Previous Page">
                <i class="bi bi-chevron-left"></i>
            </button>
            <span class="preview-zoom-level">Page ${currentPage} of ${totalPages}</span>
            <button class="preview-tool-button pdf-next" title="Next Page">
                <i class="bi bi-chevron-right"></i>
            </button>
            <div style="width: 1px; background: rgba(255,255,255,0.2); height: 24px; margin: 0 10px;"></div>
            <button class="preview-tool-button zoom-out" title="Zoom Out">
                <i class="bi bi-zoom-out"></i>
            </button>
            <span class="preview-zoom-level">100%</span>
            <button class="preview-tool-button zoom-in" title="Zoom In">
                <i class="bi bi-zoom-in"></i>
            </button>
            <button class="preview-tool-button reset-zoom" title="Reset">
                <i class="bi bi-arrow-counterclockwise"></i>
            </button>
        `;
        container.appendChild(toolbar);
        
        const renderPage = async (pageNum) => {
            // Get page
            const page = await pdfDoc.getPage(pageNum);
            
            // Create canvas for this page
            const canvas = document.createElement('canvas');
            canvasContainer.innerHTML = '';
            canvasContainer.appendChild(canvas);
            
            const context = canvas.getContext('2d');
            
            // Set scale based on container width
            const viewport = page.getViewport({ scale: 1 });
            const containerWidth = canvasContainer.clientWidth;
            const scale = containerWidth / viewport.width;
            const scaledViewport = page.getViewport({ scale: scale * this.currentZoom });
            
            // Set canvas dimensions
            canvas.height = scaledViewport.height;
            canvas.width = scaledViewport.width;
            
            // Render PDF page
            const renderContext = {
                canvasContext: context,
                viewport: scaledViewport
            };
            
            await page.render(renderContext).promise;
            
            // Update page info
            toolbar.querySelector('.preview-zoom-level').textContent = 
                `Page ${currentPage} of ${totalPages}`;
        };
        
        // Initial render
        await renderPage(currentPage);
        
        // Add zoom controls
        const canvas = canvasContainer.querySelector('canvas');
        const updateZoom = this.addZoomControls(container, canvas, 'pdf');
        
        // Navigation controls
        toolbar.querySelector('.pdf-prev').addEventListener('click', async () => {
            if (currentPage > 1) {
                currentPage--;
                await renderPage(currentPage);
            }
        });
        
        toolbar.querySelector('.pdf-next').addEventListener('click', async () => {
            if (currentPage < totalPages) {
                currentPage++;
                await renderPage(currentPage);
            }
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', async (e) => {
            if (e.key === 'ArrowLeft' && currentPage > 1) {
                currentPage--;
                await renderPage(currentPage);
            } else if (e.key === 'ArrowRight' && currentPage < totalPages) {
                currentPage++;
                await renderPage(currentPage);
            } else {
                this.handleKeyDown(e, container);
            }
        });
    }

    /**
     * Render Google Spreadsheet
     */
    renderSpreadsheet(file, container) {
        container.innerHTML = `
            <div class="spreadsheet-preview">
                <iframe src="${file.webViewLink.replace('/view', '/preview')}" 
                        width="100%" height="400" frameborder="0"></iframe>
            </div>
            <div class="file-actions mt-2">
                <a href="${file.webViewLink}" target="_blank" class="btn btn-sm btn-outline-primary">
                    Open in Google Drive
                </a>
            </div>
        `;
    }

    /**
     * Render Google Doc or Word document
     */
    renderDocument(file, container) {
        container.innerHTML = `
            <div class="document-preview">
                <iframe src="${file.webViewLink.replace('/view', '/preview')}" 
                        width="100%" height="400" frameborder="0"></iframe>
            </div>
            <div class="file-actions mt-2">
                <a href="${file.webViewLink}" target="_blank" class="btn btn-sm btn-outline-primary">
                    Open in Google Drive
                </a>
            </div>
        `;
    }

    /**
     * Render Google Slides or PowerPoint
     */
    renderPresentation(file, container) {
        container.innerHTML = `
            <div class="presentation-preview">
                <iframe src="${file.webViewLink.replace('/view', '/preview')}" 
                        width="100%" height="400" frameborder="0"></iframe>
            </div>
            <div class="file-actions mt-2">
                <a href="${file.webViewLink}" target="_blank" class="btn btn-sm btn-outline-primary">
                    Open in Google Drive
                </a>
            </div>
        `;
    }

    /**
     * Render generic file (no preview)
     */
    renderGenericFile(file, container) {
        // Get file icon based on mime type
        let icon = 'file-earmark';
        if (file.mimeType.includes('audio')) {
            icon = 'file-earmark-music';
        } else if (file.mimeType.includes('video')) {
            icon = 'file-earmark-play';
        } else if (file.mimeType.includes('zip') || file.mimeType.includes('archive')) {
            icon = 'file-earmark-zip';
        } else if (file.mimeType.includes('text')) {
            icon = 'file-earmark-text';
        }
        
        container.innerHTML = `
            <div class="generic-file-preview">
                <div class="file-icon">
                    <i class="bi bi-${icon}"></i>
                </div>
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-type">${this.formatMimeType(file.mimeType)}</div>
                </div>
            </div>
            <div class="file-actions mt-2">
                <a href="${file.webContentLink}" class="btn btn-sm btn-primary">
                    <i class="bi bi-download"></i> Download
                </a>
                <a href="${file.webViewLink}" target="_blank" class="btn btn-sm btn-outline-primary">
                    <i class="bi bi-google"></i> Open in Google Drive
                </a>
            </div>
        `;
    }

    /**
     * Format MIME type for display
     */
    formatMimeType(mimeType) {
        const types = {
            'application/pdf': 'PDF Document',
            'application/msword': 'Word Document',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word Document',
            'application/vnd.ms-excel': 'Excel Spreadsheet',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel Spreadsheet',
            'application/vnd.ms-powerpoint': 'PowerPoint Presentation',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint Presentation',
            'application/zip': 'ZIP Archive',
            'application/x-zip-compressed': 'ZIP Archive',
            'application/x-rar-compressed': 'RAR Archive',
            'text/plain': 'Text File',
            'text/html': 'HTML File',
            'text/css': 'CSS File',
            'text/javascript': 'JavaScript File',
            'application/json': 'JSON File'
        };
        
        return types[mimeType] || mimeType;
    }
}

// Export as singleton
const fileViewer = new FileViewer();
export default fileViewer; 