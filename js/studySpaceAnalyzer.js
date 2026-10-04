/**
 * Study Space Analyzer Module
 * Handles study space image analysis and location management
 */

function getGpaceApiClient() {
    if (window.gpaceApiClient) return Promise.resolve(window.gpaceApiClient);
    if (!window.__gpaceApiClientPromise) {
        const moduleUrl = new URL('/js/services/ApiClient.js', window.location.origin).href;
        window.__gpaceApiClientPromise = import(moduleUrl).then(({ getApiClient }) => getApiClient());
    }
    return window.__gpaceApiClientPromise;
}

// Analyze study space image
async function analyzeStudySpace(spaceId, file) {
    try {
        const client = await getGpaceApiClient();
        const uploadResult = await client.upload(file);
        const upload = uploadResult && uploadResult.uploads && uploadResult.uploads[0];
        if (!upload || !upload.uploadId) throw new Error('Upload did not return an uploadId.');

        // Analyze the uploaded image
        const result = await client.post('/api/analyze-study-space', { uploadId: upload.uploadId });
        const analysis = result.analysis || result;

        // Update the study space card with AI insights
        const spaceCard = document.querySelector(`#space${spaceId}`);
        if (!spaceCard) return;
        const insightsDiv = spaceCard.querySelector('.ai-insights') || document.createElement('div');
        insightsDiv.className = 'ai-insights mt-4';
        insightsDiv.innerHTML = `
            <h5>AI Analysis</h5>
            <ul class="list-unstyled">
                <li class="mb-2">Noise Level: ${analysis.noiseLevel}</li>
                <li class="mb-2">Seating: ${analysis.seating}</li>
                <li class="mb-2">Lighting: ${analysis.lighting}</li>
                <li class="mb-2">Power Outlets: ${analysis.powerOutlets}</li>
                <li class="mb-2">Space Type: ${analysis.spaceType}</li>
            </ul>
        `;
        spaceCard.appendChild(insightsDiv);

    } catch (error) {
        console.error('Error analyzing study space:', error);
        if (error && error.authFailure) {
            alert('Please sign in again. Your study-space draft is still available.');
        } else {
            alert('Failed to analyze study space. Please try again.');
        }
    }
}

// Load saved locations
async function loadSavedLocations() {
    try {
        const client = await getGpaceApiClient();
        const data = await client.get('/api/locations');
        if (Array.isArray(data.locations)) {
            const locationsContainer = document.querySelector('.locations-container');
            if (!locationsContainer) return;
            data.locations.forEach(location => {
                const locationCard = createLocationCard(location, client);
                locationsContainer.appendChild(locationCard);
            });
        }
    } catch (error) {
        console.error('Error loading saved locations:', error);
    }
}

// Create location card
function createLocationCard(location, client) {
    const card = document.createElement('div');
    card.className = 'study-space-card mb-4';

    const img = document.createElement('img');
    img.alt = 'Study Space upload';
    img.src = '';
    if (location.uploadId && client) {
        client.uploadObjectUrl(location.uploadId)
            .then((url) => { if (url) img.src = url; })
            .catch((error) => {
                if (!error || !error.authFailure) console.warn('Could not load study-space upload', error);
            });
    }
    img.className = 'img-fluid rounded mb-3';

    const details = document.createElement('div');
    details.className = 'location-details';
    details.innerHTML = `
        <h3>Study Space Analysis</h3>
        <p class="mb-3">${location.analysis.description || ''}</p>
        <div class="features">
            ${location.analysis.features ? location.analysis.features.map(feature =>
                `<span class="badge bg-secondary me-2 mb-2">${feature}</span>`
            ).join('') : ''}
        </div>
    `;

    card.appendChild(img);
    card.appendChild(details);
    return card;
}

// Handle profile icon visibility
function setupProfileIconVisibility() {
    let lastScrollTop = 0;
    const profileIcon = document.querySelector('.profile-icon');
    
    if (!profileIcon) return;

    window.addEventListener('scroll', () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        if (scrollTop < lastScrollTop || scrollTop < 100) {
            // Scrolling up or near top
            profileIcon.classList.add('visible');
        } else {
            // Scrolling down
            profileIcon.classList.remove('visible');
        }

        lastScrollTop = scrollTop;
    });

    // Show initially if at top of page
    if (window.pageYOffset < 100) {
        profileIcon.classList.add('visible');
    }
}

// Initialize study space analyzer
function initializeStudySpaceAnalyzer() {
    // Load saved locations
    loadSavedLocations();
    
    // Setup profile icon visibility
    setupProfileIconVisibility();
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeStudySpaceAnalyzer);

// Export functions for global use
window.analyzeStudySpace = analyzeStudySpace;
