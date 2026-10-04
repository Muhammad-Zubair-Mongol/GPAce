/**
 * Camera Capture Module
 * Handles video stream access, frame capture, and UI integration.
 */
class CameraCapture {
    constructor() {
        this.stream = null;
        this.videoElement = null;
        this.canvasElement = null;
        this.overlayElement = null;
        this.isActive = false;
        this.onCaptureCallback = null;
    }

    /**
     * Initialize camera UI and start stream
     * @param {HTMLElement} container - Container to inject camera UI
     * @param {Function} onCapture - Callback when photo is taken
     */
    async startCamera(container, onCapture) {
        if (this.isActive) return;
        this.onCaptureCallback = onCapture;

        // 1. Create UI Elements
        this.createCameraUI(container);

        // 2. Request Camera Access
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false
            });
            this.videoElement.srcObject = this.stream;
            this.videoElement.play();
            this.isActive = true;
        } catch (error) {
            console.error('[CameraCapture] Access denied or error:', error);
            this.showError('Camera access denied. Please verify permissions.');
            this.cleanup();
        }
    }

    /**
     * Create the Camera Modal/Overlay
     */
    createCameraUI(container) {
        const wrapper = document.createElement('div');
        wrapper.id = 'camera-overlay';
        wrapper.className = 'camera-overlay fixed top-0 left-0 w-full h-full bg-black z-50 flex flex-col items-center justify-center';
        wrapper.style.position = 'fixed';
        wrapper.style.top = '0';
        wrapper.style.left = '0';
        wrapper.style.width = '100vw';
        wrapper.style.height = '100vh';
        wrapper.style.backgroundColor = '#000';
        wrapper.style.zIndex = '9999';

        wrapper.innerHTML = `
            <video id="camera-video" class="w-full h-full object-cover" autoplay playsinline style="width:100%; height:100%; object-fit:cover;"></video>
            <canvas id="camera-canvas" style="display:none;"></canvas>
            
            <div class="camera-controls" style="position:absolute; bottom:30px; left:0; width:100%; display:flex; justify-content:center; gap:20px; padding-bottom: 20px;">
                <button id="btn-close-camera" class="btn btn-secondary rounded-circle" style="width:50px; height:50px; border-radius:50%; background:rgba(255,255,255,0.2); color:white; font-size:24px;">&times;</button>
                <button id="btn-capture-photo" class="btn btn-primary rounded-circle" style="width:70px; height:70px; border-radius:50%; background:white; border:4px solid rgba(0,0,0,0.2);"></button>
            </div>
            
            <div id="camera-error" style="position:absolute; top:50%; width:100%; text-align:center; color:white; display:none;"></div>
        `;

        container.appendChild(wrapper);
        this.overlayElement = wrapper;
        this.videoElement = wrapper.querySelector('#camera-video');
        this.canvasElement = wrapper.querySelector('#camera-canvas');

        // Bind Events
        wrapper.querySelector('#btn-close-camera').addEventListener('click', () => this.stopCamera());
        wrapper.querySelector('#btn-capture-photo').addEventListener('click', () => this.captureFrame());
    }

    /**
     * Capture a frame from video stream
     */
    captureFrame() {
        if (!this.stream || !this.isActive) return;

        const width = this.videoElement.videoWidth;
        const height = this.videoElement.videoHeight;

        this.canvasElement.width = width;
        this.canvasElement.height = height;
        const ctx = this.canvasElement.getContext('2d');
        ctx.drawImage(this.videoElement, 0, 0, width, height);

        // Convert to Blob or DataURL
        this.canvasElement.toBlob(async (blob) => {
            if (this.onCaptureCallback) {
                // Flash effect
                this.videoElement.style.opacity = '0.5';
                setTimeout(() => this.videoElement.style.opacity = '1', 100);

                // Allow user to retake or accept? For now, auto-accept.
                this.stopCamera(); // Close cam
                this.onCaptureCallback(blob);
            }
        }, 'image/jpeg', 0.85);
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        if (this.overlayElement) {
            this.overlayElement.remove();
            this.overlayElement = null;
        }
        this.isActive = false;
    }

    showError(msg) {
        if (this.overlayElement) {
            const errDiv = this.overlayElement.querySelector('#camera-error');
            if (errDiv) {
                errDiv.textContent = msg;
                errDiv.style.display = 'block';
            }
        }
    }

    cleanup() {
        this.stopCamera();
    }
}

// Singleton or Class Export
export default new CameraCapture();
