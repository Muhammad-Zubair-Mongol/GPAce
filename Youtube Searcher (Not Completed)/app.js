// app.js
// ─── CONFIG ─────────────────────────────────────────────────
const MAX_RESULTS    = 12;
const USE_SENTIMENT  = true;
const USE_LLM        = true;

// DOM hooks
const imgInput    = document.getElementById('imgInput');
const imgPreview  = document.getElementById('imgPreview');
const videoGrid   = document.getElementById('videoResults');
const labelInput  = document.getElementById('labelInput');
const labelButton = document.getElementById('labelButton');

// Models & keys
const GEMINI_MODEL    = 'gemini-2.5-flash-preview-04-17';
const THINKING_BUDGET = 1024;

// Globals
let model, sentiment;

(async function init() {
  try {
    if (!USE_LLM) model = await mobilenet.load();
    if (USE_SENTIMENT && window.Sentiment) {
      sentiment = new Sentiment();
    }
  } catch (error) {
    console.error('Initialization error:', error);
  }
})();

function getYoutubeApiKey() {
  return document.getElementById('youtubeApiKeyInput').value.trim();
}

function setYoutubeApiKey(key) {
  document.getElementById('youtubeApiKeyInput').value = key;
}

function getGeminiApiKey() {
  return document.getElementById('geminiApiKeyInput').value.trim();
}

function setGeminiApiKey(key) {
  document.getElementById('geminiApiKeyInput').value = key;
}

// --- API Key Persistence ---
function saveApiKeys() {
  const ytKey = getYoutubeApiKey();
  const gmKey = getGeminiApiKey();
  if (ytKey) localStorage.setItem('youtubeApiKey', ytKey);
  if (gmKey) localStorage.setItem('geminiApiKey', gmKey);
}

function loadApiKeys() {
  try {
    const yt = localStorage.getItem('youtubeApiKey') || '';
    const gm = localStorage.getItem('geminiApiKey') || '';
    if (yt) setYoutubeApiKey(yt);
    if (gm) setGeminiApiKey(gm);
  } catch (e) {
    console.error('Failed to load API keys:', e);
  }
}

document.getElementById('youtubeApiKeyInput').addEventListener('change', saveApiKeys);
document.getElementById('geminiApiKeyInput').addEventListener('change', saveApiKeys);
window.addEventListener('DOMContentLoaded', () => {
  loadApiKeys();
  renderSearchHistory();
});
imgInput.addEventListener('change', async () => {
  videoGrid.innerHTML = '';
  imgPreview.hidden = true;

  const file = imgInput.files[0];
  if (!file) return;
  
  // Validate file type and size
  if (!file.type.startsWith('image/')) {
    videoGrid.innerHTML = '<p class="error">Please select a valid image file.</p>';
    return;
  }
  
  if (file.size > 4 * 1024 * 1024) {
    videoGrid.innerHTML = '<p class="error">Image file is too large. Please select an image under 4MB.</p>';
    return;
  }

  // Clear previous results and show loading state
  videoGrid.innerHTML = '<p class="loading">Processing image…</p>';
  imgPreview.hidden = true;
  
  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const dataURL = e.target.result;
        
        // Update preview
        imgPreview.src = dataURL;
        imgPreview.hidden = false;
        
        // Show AI analysis state
        videoGrid.innerHTML = '<p class="loading">Analyzing image with AI…</p>';
        
        // Get image description
        const searchPrompt = USE_LLM
          ? await getDescriptionFromLLM(dataURL)
          : (await getLabelsFromTFJS(imgPreview)).join(', ');
          
        if (!searchPrompt?.trim()) {
          throw new Error('Could not detect any meaningful content in this image');
        }
        
        // Show search state
        videoGrid.innerHTML = `<p class="loading">Searching YouTube for: "${searchPrompt}"</p>`;
        
        // Search and display results
        await searchYouTube(searchPrompt.split(',').map(s => s.trim()));
        
      } catch (err) {
        console.error('Image processing error:', err);
        let errorMessage = err.message || 'Failed to process image';
        
        // Handle specific error cases
        if (err.message.includes('API key')) {
          errorMessage = 'Please enter your Gemini API key first';
        } else if (err.message.includes('rate limit')) {
          errorMessage = 'Too many requests. Please wait a moment and try again';
        } else if (err.message.includes('API request failed')) {
          errorMessage = 'API request failed. Please check your API key and try again';
        }
        
        videoGrid.innerHTML = `<p class="error">${errorMessage}. Please try again.</p>`;
      }
    };
    
    reader.onerror = () => {
      videoGrid.innerHTML = '<p class="error">Failed to read image file. Please try again.</p>';
    };
    
    reader.readAsDataURL(file);
    
  } catch (err) {
    console.error('File reading error:', err);
    videoGrid.innerHTML = '<p class="error">Unexpected error while reading file. Please try again.</p>';
  }
});

// --- Search History Logic ---
function saveSearchHistory(labels) {
  if (!Array.isArray(labels) || !labels.length) return;
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
  } catch {}
  history.unshift({ labels, date: new Date().toISOString() });
  history = history.slice(0, 20); // Keep last 20
  localStorage.setItem('searchHistory', JSON.stringify(history));
}

function loadSearchHistory() {
  try {
    return JSON.parse(localStorage.getItem('searchHistory') || '[]');
  } catch { return []; }
}

function renderSearchHistory() {
  const history = loadSearchHistory();
  const container = document.getElementById('searchHistory');
  if (!container) return;
  container.innerHTML = '';
  history.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `<span>${item.labels.join(', ')}</span> <button data-idx="${idx}">Search</button>`;
    container.appendChild(div);
  });
  container.querySelectorAll('button').forEach(btn => {
    btn.onclick = (e) => {
      const idx = +e.target.getAttribute('data-idx');
      const labels = history[idx].labels;
      if (labels) searchYouTube(labels);
    };
  });
}

labelButton.addEventListener('click', () => {
  const input = labelInput.value.trim();
  if (!input) return;
  const labels = input.split(',').map(l => l.trim()).filter(Boolean);
  if (labels.length) {
    saveSearchHistory(labels);
    renderSearchHistory();
    searchYouTube(labels);
  }
});

async function getLabelsFromTFJS(imageEl) {
  if (!model) {
    throw new Error('Image analysis model is not loaded. Please try again in a moment.');
  }
  if (!imageEl || !imageEl.complete || !imageEl.naturalHeight) {
    throw new Error('Image is not properly loaded. Please try again.');
  }
  try {
    const preds = await model.classify(imageEl);
    if (!preds?.length) {
      throw new Error('Could not analyze the image. Please try a different image.');
    }
    return preds.slice(0, 3).map(p => p.className);
  } catch (error) {
    console.error('TFJS Error:', error);
    throw new Error('Failed to analyze image. Please try again.');
  }
}

async function getDescriptionFromLLM(dataURL) {
  const base64 = dataURL.split(',')[1];
  const key = getGeminiApiKey();
  
  // Enhanced API key validation
  if (!key) {
    throw new Error('Please enter your Gemini API key first');
  }
  if (key.length < 20) {
    throw new Error('Invalid Gemini API key format. Please check your key');
  }

  // Show loading state
  videoGrid.innerHTML = '<p>Connecting to Gemini API...</p>';
  
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const prompt = "Analyze this image and provide 3-5 relevant search terms that would help find similar content on YouTube. Format the response as comma-separated values. Focus on key objects, actions, and themes visible in the image. Keep each term concise (1-3 words).";
  
  const body = {
    contents: [{
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64
          }
        },
        {
          text: prompt
        }
      ]
    }],
    generationConfig: {
      temperature: 0.4,
      topK: 32,
      topP: 1,
      maxOutputTokens: 1024
    }
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('Invalid or expired API key. Please check your Gemini API key');
      } else if (res.status === 429) {
        throw new Error('API rate limit exceeded. Please try again in a few minutes');
      } else if (res.status >= 500) {
        throw new Error('Gemini API service is currently unavailable. Please try again later');
      } else {
        throw new Error(`API request failed: ${res.status} ${res.statusText}`);
      }
    }

    const json = await res.json();
    if (!json.candidates?.[0]?.content?.parts?.length) {
      throw new Error('Could not generate description from this image. Please try another image');
    }

    const text = json.candidates[0].content.parts
      .map(p => p.text || '')
      .join(' ')
      .trim();

    if (!text) {
      throw new Error('Received empty description from API. Please try another image');
    }

    return text;
  } catch (error) {
    console.error('LLM API Error:', error);
    // Convert technical errors into user-friendly messages
    if (error.name === 'TypeError' || error.name === 'NetworkError') {
      throw new Error('Network connection failed. Please check your internet connection');
    }
    throw error;
  }
}

async function searchYouTube(labels) {
  videoGrid.innerHTML = '<p>Searching…</p>';
  const key = getYoutubeApiKey();
  const calls = labels.map(lbl => {
    const q = encodeURIComponent(lbl);
    const url =
      `https://www.googleapis.com/youtube/v3/search?` +
      `key=${key}&part=snippet&type=video&maxResults=${MAX_RESULTS}&q=${q}`;
    return fetch(url).then(r => r.json());
  });
  const results = await Promise.all(calls);
  const all = results.flatMap(r => r.items || []);
  const unique = Array.from(new Map(all.map(i => [i.id.videoId, i])).values());
  if (USE_SENTIMENT) {
    unique.forEach(v => v._score = sentiment.analyze(v.snippet.title).score);
    unique.sort((a,b) => (b._score||0)-(a._score||0));
  }
  renderVideos(unique.slice(0, MAX_RESULTS));
}

function renderVideos(videos) {
  videoGrid.innerHTML = '';
  videos.forEach(video => {
    const vid = video.id.videoId;
    const thumb = video.snippet.thumbnails.medium.url;
    const title = video.snippet.title;
    const score = video._score;
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `https://youtu.be/${vid}`;
    card.target = '_blank';
    card.innerHTML =
      `<img src="${thumb}" alt="${title}">` +
      `<h4>${title}</h4>` +
      (USE_SENTIMENT ? `<span class="badge">✬ ${score}</span>` : '');
    videoGrid.appendChild(card);
  });
}

window.addEventListener('DOMContentLoaded', renderSearchHistory);