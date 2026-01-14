/* ============================================
WIKIPEDIA QUILT - MAIN JAVASCRIPT
With on-screen debugging for mobile
============================================ */

// ============================================
// CONFIGURABLE CONSTANTS
// ============================================

const TARGET_TILES = 40;
const THUMB_WIDTH = 400;
const COLOR_TOLERANCE = 60;
const MIN_MATCH_PERCENT = 3;
const SAMPLE_STRIDE = 10;
const MAX_ATTEMPTS = 200;
const BATCH_SIZE = 10;

// Set to true to see debug messages on screen
const DEBUG_MODE = true;

// ============================================
// WIKIMEDIA API CONFIGURATION
// ============================================

const COMMONS_API = ‘https://commons.wikimedia.org/w/api.php’;
const COMMONS_FILE_BASE = ‘https://commons.wikimedia.org/wiki/’;

// ============================================
// APPLICATION STATE
// ============================================

const state = {
colorFilterEnabled: false,
selectedColor: { r: 230, g: 57, b: 70 },
tiles: [],
isLoading: false,
colorAnalysisCache: new Map(),
abortController: null
};

// ============================================
// DEBUG LOGGING
// ============================================

function debugLog(message) {
console.log(message);
if (DEBUG_MODE) {
let debugBox = document.getElementById(‘debugBox’);
if (!debugBox) {
debugBox = document.createElement(‘div’);
debugBox.id = ‘debugBox’;
debugBox.style.cssText = `position: fixed; bottom: 10px; left: 10px; right: 10px; max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.85); color: #0f0; font-family: monospace; font-size: 11px; padding: 10px; border-radius: 8px; z-index: 9999; white-space: pre-wrap; word-break: break-all;`;
document.body.appendChild(debugBox);
}
const time = new Date().toLocaleTimeString();
debugBox.textContent = `[${time}] ${message}\n` + debugBox.textContent;
// Keep only last 20 messages
const lines = debugBox.textContent.split(’\n’).slice(0, 20);
debugBox.textContent = lines.join(’\n’);
}
}

// ============================================
// DOM ELEMENTS
// ============================================

let elements = {};

function initElements() {
elements = {
quiltGrid: document.getElementById(‘quiltGrid’),
colorToggle: document.getElementById(‘colorToggle’),
colorPicker: document.getElementById(‘colorPicker’),
rerollBtn: document.getElementById(‘rerollBtn’),
loadingOverlay: document.getElementById(‘loadingOverlay’),
loadingProgress: document.getElementById(‘loadingProgress’),
messageDisplay: document.getElementById(‘messageDisplay’),
messageText: document.getElementById(‘messageText’)
};

```
// Check if elements exist
for (const [name, el] of Object.entries(elements)) {
    if (!el) {
        debugLog(`ERROR: Element not found: ${name}`);
    }
}
```

}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function hexToRgb(hex) {
const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
return result ? {
r: parseInt(result[1], 16),
g: parseInt(result[2], 16),
b: parseInt(result[3], 16)
} : null;
}

function colorDistance(c1, c2) {
return Math.sqrt(
Math.pow(c1.r - c2.r, 2) +
Math.pow(c1.g - c2.g, 2) +
Math.pow(c1.b - c2.b, 2)
);
}

function truncate(str, maxLength) {
if (!str) return ‘’;
return str.length > maxLength ? str.slice(0, maxLength - 1) + ‘…’ : str;
}

function extractFilename(title) {
let name = title.replace(/^File:/, ‘’).replace(/.[^/.]+$/, ‘’);
name = name.replace(/_/g, ’ ’);
return truncate(name, 60);
}

function showMessage(text, duration = 5000) {
if (elements.messageText && elements.messageDisplay) {
elements.messageText.textContent = text;
elements.messageDisplay.classList.remove(‘hidden’);
setTimeout(() => {
elements.messageDisplay.classList.add(‘hidden’);
}, duration);
}
}

function updateProgress(current, total) {
if (elements.loadingProgress) {
elements.loadingProgress.textContent = `${current} / ${total} tiles`;
}
}

function setLoading(isLoading) {
state.isLoading = isLoading;
if (elements.loadingOverlay) {
if (isLoading) {
elements.loadingOverlay.classList.remove(‘hidden’);
} else {
elements.loadingOverlay.classList.add(‘hidden’);
}
}
}

// ============================================
// WIKIMEDIA API FUNCTIONS
// ============================================

async function fetchRandomImages(count = BATCH_SIZE) {
const params = new URLSearchParams({
action: ‘query’,
format: ‘json’,
origin: ‘*’,
generator: ‘random’,
grnnamespace: ‘6’,
grnlimit: String(count),
prop: ‘imageinfo’,
iiprop: ‘url|extmetadata|mime’,
iiurlwidth: String(THUMB_WIDTH)
});

```
const url = `${COMMONS_API}?${params.toString()}`;
debugLog(`Fetching from API...`);

try {
    const response = await fetch(url);
    debugLog(`Response status: ${response.status}`);
    
    if (!response.ok) {
        debugLog(`ERROR: API returned ${response.status}`);
        return [];
    }
    
    const data = await response.json();
    debugLog(`Got JSON response`);
    
    if (!data.query || !data.query.pages) {
        debugLog(`ERROR: No pages in response`);
        debugLog(`Response keys: ${Object.keys(data).join(', ')}`);
        return [];
    }

    const pages = Object.values(data.query.pages);
    debugLog(`Found ${pages.length} pages`);

    const images = [];
    
    for (const page of pages) {
        if (!page.imageinfo || page.imageinfo.length === 0) {
            continue;
        }
        
        const info = page.imageinfo[0];
        
        if (!info.mime || !info.mime.startsWith('image/')) {
            continue;
        }
        
        if (!info.thumburl) {
            continue;
        }
        
        if (info.mime === 'image/svg+xml') {
            continue;
        }
        
        const meta = info.extmetadata || {};
        
        let author = 'Unknown';
        if (meta.Artist && meta.Artist.value) {
            author = meta.Artist.value.replace(/<[^>]*>/g, '').trim();
            if (author.length > 50) author = author.substring(0, 50) + '...';
        }
        
        let license = 'Unknown license';
        if (meta.LicenseShortName && meta.LicenseShortName.value) {
            license = meta.LicenseShortName.value;
        } else if (meta.License && meta.License.value) {
            license = meta.License.value;
        }
        
        images.push({
            title: page.title,
            displayName: extractFilename(page.title),
            thumbUrl: info.thumburl,
            fullUrl: info.url || info.thumburl,
            descriptionUrl: info.descriptionurl || `${COMMONS_FILE_BASE}${encodeURIComponent(page.title)}`,
            author: author,
            license: license
        });
    }

    debugLog(`Processed ${images.length} valid images`);
    return images;
    
} catch (error) {
    debugLog(`FETCH ERROR: ${error.message}`);
    return [];
}
```

}

// ============================================
// COLOR ANALYSIS FUNCTIONS
// ============================================

function loadImage(url) {
return new Promise((resolve, reject) => {
const img = new Image();
img.crossOrigin = ‘anonymous’;

```
    const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
    }, 10000);
    
    img.onload = () => {
        clearTimeout(timeout);
        resolve(img);
    };
    
    img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Load failed'));
    };
    
    img.src = url;
});
```

}

async function analyzeImageColor(imageUrl, targetColor) {
const cacheKey = `${imageUrl}_${targetColor.r}_${targetColor.g}_${targetColor.b}`;
if (state.colorAnalysisCache.has(cacheKey)) {
return state.colorAnalysisCache.get(cacheKey);
}

```
try {
    const img = await loadImage(imageUrl);
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    const maxSize = 100;
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);
    
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    let imageData;
    try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
        state.colorAnalysisCache.set(cacheKey, false);
        return false;
    }
    
    const pixels = imageData.data;
    let matchingPixels = 0;
    let sampledPixels = 0;
    
    for (let i = 0; i < pixels.length; i += 4 * SAMPLE_STRIDE) {
        if (pixels[i + 3] < 128) continue;
        sampledPixels++;
        const pixelColor = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] };
        if (colorDistance(pixelColor, targetColor) <= COLOR_TOLERANCE) {
            matchingPixels++;
        }
    }
    
    const matchPercent = sampledPixels > 0 ? (matchingPixels / sampledPixels) * 100 : 0;
    const passes = matchPercent >= MIN_MATCH_PERCENT;
    
    state.colorAnalysisCache.set(cacheKey, passes);
    return passes;
} catch (error) {
    state.colorAnalysisCache.set(cacheKey, false);
    return false;
}
```

}

// ============================================
// TILE CREATION & RENDERING
// ============================================

function escapeHtml(text) {
const div = document.createElement(‘div’);
div.textContent = text;
return div.innerHTML;
}

function createTileElement(imageData) {
const tile = document.createElement(‘article’);
tile.className = ‘quilt-tile’;
tile.tabIndex = 0;

```
const img = document.createElement('img');
img.className = 'tile-image';
img.src = imageData.thumbUrl;
img.alt = imageData.displayName;
img.loading = 'lazy';

img.onerror = function() {
    debugLog(`Image failed: ${imageData.displayName}`);
    tile.style.display = 'none';
};

const attribution = document.createElement('div');
attribution.className = 'tile-attribution';
attribution.innerHTML = `
    <h3 class="tile-title">${escapeHtml(imageData.displayName)}</h3>
    <div class="tile-meta">
        <span class="tile-author">${escapeHtml(truncate(imageData.author, 30))}</span>
        <span class="tile-license">${escapeHtml(truncate(imageData.license, 20))}</span>
    </div>
`;

tile.appendChild(img);
tile.appendChild(attribution);

tile.addEventListener('click', () => {
    window.open(imageData.descriptionUrl, '_blank', 'noopener,noreferrer');
});

return tile;
```

}

function clearGrid() {
if (elements.quiltGrid) {
elements.quiltGrid.innerHTML = ‘’;
}
state.tiles = [];
}

function addTileToGrid(imageData) {
if (elements.quiltGrid) {
const tile = createTileElement(imageData);
elements.quiltGrid.appendChild(tile);
state.tiles.push(imageData);
}
}

// ============================================
// MAIN QUILT BUILDING LOGIC
// ============================================

async function buildQuilt() {
if (state.abortController) {
state.abortController.abort();
}
state.abortController = new AbortController();

```
clearGrid();
setLoading(true);
updateProgress(0, TARGET_TILES);

const targetColor = state.colorFilterEnabled ? state.selectedColor : null;
let attempts = 0;
let consecutiveFailures = 0;

debugLog(`Starting quilt build. Color filter: ${targetColor ? 'ON' : 'OFF'}`);

try {
    while (state.tiles.length < TARGET_TILES && attempts < MAX_ATTEMPTS) {
        if (state.abortController.signal.aborted) {
            debugLog('Build aborted');
            return;
        }
        
        const candidates = await fetchRandomImages(BATCH_SIZE);
        attempts++;
        
        if (candidates.length === 0) {
            consecutiveFailures++;
            debugLog(`No images returned. Failures: ${consecutiveFailures}`);
            if (consecutiveFailures > 10) {
                showMessage('Having trouble connecting to Wikimedia. Please try again.');
                debugLog('Too many failures, stopping');
                break;
            }
            await new Promise(r => setTimeout(r, 500));
            continue;
        }
        
        consecutiveFailures = 0;
        
        for (const imageData of candidates) {
            if (state.tiles.length >= TARGET_TILES) break;
            
            if (targetColor) {
                const passes = await analyzeImageColor(imageData.thumbUrl, targetColor);
                if (!passes) continue;
            }
            
            addTileToGrid(imageData);
            updateProgress(state.tiles.length, TARGET_TILES);
        }
        
        debugLog(`Progress: ${state.tiles.length}/${TARGET_TILES} tiles`);
    }
    
    debugLog(`Build complete: ${state.tiles.length} tiles`);
    
    if (state.tiles.length === 0) {
        if (targetColor) {
            showMessage('No images found with that color. Try a different shade!');
        } else {
            showMessage('Could not load images. Please check your connection and try again.');
        }
    }
    
} catch (error) {
    debugLog(`BUILD ERROR: ${error.message}`);
    showMessage('Something went wrong. Please try again.');
} finally {
    setLoading(false);
}
```

}

// ============================================
// EVENT HANDLERS
// ============================================

function handleColorToggle(event) {
state.colorFilterEnabled = event.target.checked;
if (elements.colorPicker) {
elements.colorPicker.disabled = !state.colorFilterEnabled;
}
debugLog(`Color filter: ${state.colorFilterEnabled ? 'ON' : 'OFF'}`);
buildQuilt();
}

function handleColorChange(event) {
const rgb = hexToRgb(event.target.value);
if (rgb) {
state.selectedColor = rgb;
debugLog(`Color changed to: ${event.target.value}`);
if (state.colorFilterEnabled) {
buildQuilt();
}
}
}

function handleReroll() {
debugLog(‘Re-roll clicked’);
state.colorAnalysisCache.clear();
buildQuilt();
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
debugLog(‘Wikipedia Quilt initializing…’);

```
initElements();

if (elements.colorToggle) {
    elements.colorToggle.addEventListener('change', handleColorToggle);
}
if (elements.colorPicker) {
    elements.colorPicker.addEventListener('change', handleColorChange);
    const defaultColor = '#' + 
        state.selectedColor.r.toString(16).padStart(2, '0') +
        state.selectedColor.g.toString(16).padStart(2, '0') +
        state.selectedColor.b.toString(16).padStart(2, '0');
    elements.colorPicker.value = defaultColor;
}
if (elements.rerollBtn) {
    elements.rerollBtn.addEventListener('click', handleReroll);
}

debugLog('Starting initial build...');
buildQuilt();
```

}

// Start when DOM is ready
if (document.readyState === ‘loading’) {
document.addEventListener(‘DOMContentLoaded’, init);
} else {
init();
}
