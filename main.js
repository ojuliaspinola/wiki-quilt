/* ============================================
WIKIPEDIA QUILT - MAIN JAVASCRIPT
A client-side app that creates a quilt of
Wikipedia/Wikimedia Commons images
============================================ */

// ============================================
// CONFIGURABLE CONSTANTS
// Edit these to adjust app behavior
// ============================================

const TARGET_TILES = 40;           // Number of tiles to display in the quilt
const THUMB_WIDTH = 400;           // Thumbnail width to request from API (pixels)
const COLOR_TOLERANCE = 60;        // RGB distance threshold for color matching (0-441)
const MIN_MATCH_PERCENT = 3;       // Minimum % of pixels that must match the color
const SAMPLE_STRIDE = 10;          // Sample every Nth pixel for color analysis
const MAX_ATTEMPTS = 200;          // Max API requests before giving up on color filter
const BATCH_SIZE = 10;             // Number of images to request per API call

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
// DOM ELEMENTS
// ============================================

const elements = {
quiltGrid: document.getElementById(‘quiltGrid’),
colorToggle: document.getElementById(‘colorToggle’),
colorPicker: document.getElementById(‘colorPicker’),
rerollBtn: document.getElementById(‘rerollBtn’),
loadingOverlay: document.getElementById(‘loadingOverlay’),
loadingProgress: document.getElementById(‘loadingProgress’),
messageDisplay: document.getElementById(‘messageDisplay’),
messageText: document.getElementById(‘messageText’)
};

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
elements.messageText.textContent = text;
elements.messageDisplay.classList.remove(‘hidden’);

```
setTimeout(() => {
    elements.messageDisplay.classList.add('hidden');
}, duration);
```

}

function updateProgress(current, total) {
elements.loadingProgress.textContent = `${current} / ${total} tiles`;
}

function setLoading(isLoading) {
state.isLoading = isLoading;
if (isLoading) {
elements.loadingOverlay.classList.remove(‘hidden’);
} else {
elements.loadingOverlay.classList.add(‘hidden’);
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
console.log('Fetching:', url);

try {
    const response = await fetch(url);
    
    if (!response.ok) {
        console.error('API response not ok:', response.status);
        return [];
    }
    
    const data = await response.json();
    console.log('API response:', data);
    
    if (!data.query || !data.query.pages) {
        console.log('No pages in response');
        return [];
    }

    const pages = Object.values(data.query.pages);
    console.log('Found pages:', pages.length);

    const images = [];
    
    for (const page of pages) {
        // Skip if no imageinfo
        if (!page.imageinfo || page.imageinfo.length === 0) {
            console.log('Skipping - no imageinfo:', page.title);
            continue;
        }
        
        const info = page.imageinfo[0];
        
        // Skip non-images
        if (!info.mime || !info.mime.startsWith('image/')) {
            console.log('Skipping - not an image:', page.title, info.mime);
            continue;
        }
        
        // Skip if no thumbnail
        if (!info.thumburl) {
            console.log('Skipping - no thumbnail:', page.title);
            continue;
        }
        
        // Skip SVGs
        if (info.mime === 'image/svg+xml') {
            console.log('Skipping - SVG:', page.title);
            continue;
        }
        
        const meta = info.extmetadata || {};
        
        // Clean up author string (remove HTML)
        let author = 'Unknown';
        if (meta.Artist && meta.Artist.value) {
            author = meta.Artist.value.replace(/<[^>]*>/g, '').trim();
            if (author.length > 50) author = author.substring(0, 50) + '...';
        }
        
        // Get license
        let license = 'Unknown license';
        if (meta.LicenseShortName && meta.LicenseShortName.value) {
            license = meta.LicenseShortName.value;
        } else if (meta.License && meta.License.value) {
            license = meta.License.value;
        }
        
        const imageData = {
            title: page.title,
            displayName: extractFilename(page.title),
            thumbUrl: info.thumburl,
            fullUrl: info.url || info.thumburl,
            descriptionUrl: info.descriptionurl || `${COMMONS_FILE_BASE}${encodeURIComponent(page.title)}`,
            author: author,
            license: license
        };
        
        console.log('Adding image:', imageData.displayName);
        images.push(imageData);
    }

    console.log('Processed images:', images.length);
    return images;
    
} catch (error) {
    console.error('Fetch error:', error);
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
        reject(new Error('Image load timeout'));
    }, 10000);
    
    img.onload = () => {
        clearTimeout(timeout);
        resolve(img);
    };
    
    img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Image load failed'));
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
        console.warn('Canvas tainted:', imageUrl);
        state.colorAnalysisCache.set(cacheKey, false);
        return false;
    }
    
    const pixels = imageData.data;
    let matchingPixels = 0;
    let sampledPixels = 0;
    
    for (let i = 0; i < pixels.length; i += 4 * SAMPLE_STRIDE) {
        const pixelColor = {
            r: pixels[i],
            g: pixels[i + 1],
            b: pixels[i + 2]
        };
        
        if (pixels[i + 3] < 128) continue;
        
        sampledPixels++;
        
        if (colorDistance(pixelColor, targetColor) <= COLOR_TOLERANCE) {
            matchingPixels++;
        }
    }
    
    const matchPercent = sampledPixels > 0 ? (matchingPixels / sampledPixels) * 100 : 0;
    const passes = matchPercent >= MIN_MATCH_PERCENT;
    
    state.colorAnalysisCache.set(cacheKey, passes);
    
    return passes;
} catch (error) {
    console.warn('Color analysis failed:', error.message);
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
    console.warn('Image failed to load:', imageData.thumbUrl);
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

tile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.open(imageData.descriptionUrl, '_blank', 'noopener,noreferrer');
    }
});

return tile;
```

}

function clearGrid() {
elements.quiltGrid.innerHTML = ‘’;
state.tiles = [];
}

function addTileToGrid(imageData) {
const tile = createTileElement(imageData);
elements.quiltGrid.appendChild(tile);
state.tiles.push(imageData);
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

console.log('Building quilt, color filter:', targetColor);

try {
    while (state.tiles.length < TARGET_TILES && attempts < MAX_ATTEMPTS) {
        if (state.abortController.signal.aborted) {
            console.log('Aborted');
            return;
        }
        
        console.log(`Attempt ${attempts + 1}, tiles so far: ${state.tiles.length}`);
        
        const candidates = await fetchRandomImages(BATCH_SIZE);
        attempts++;
        
        if (candidates.length === 0) {
            consecutiveFailures++;
            console.log('No candidates, consecutive failures:', consecutiveFailures);
            if (consecutiveFailures > 10) {
                showMessage('Having trouble connecting to Wikimedia. Please try again.');
                break;
            }
            // Wait a bit before retrying
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
    }
    
    console.log('Finished building quilt, total tiles:', state.tiles.length);
    
    if (state.tiles.length < TARGET_TILES && targetColor) {
        if (state.tiles.length === 0) {
            showMessage('No images found with that color. Try a different shade!');
        } else if (state.tiles.length < TARGET_TILES / 2) {
            showMessage(`Found ${state.tiles.length} matching images. Try a more common color for more results.`);
        }
    }
    
    if (state.tiles.length === 0 && !targetColor) {
        showMessage('Could not load images. Please check your connection and try again.');
    }
    
} catch (error) {
    if (error.name !== 'AbortError') {
        console.error('Error building quilt:', error);
        showMessage('Something went wrong. Please try again.');
    }
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
elements.colorPicker.disabled = !state.colorFilterEnabled;
buildQuilt();
}

function handleColorChange(event) {
const rgb = hexToRgb(event.target.value);
if (rgb) {
state.selectedColor = rgb;
if (state.colorFilterEnabled) {
buildQuilt();
}
}
}

function handleReroll() {
state.colorAnalysisCache.clear();
buildQuilt();
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
console.log(‘Initializing Wikipedia Quilt…’);

```
elements.colorToggle.addEventListener('change', handleColorToggle);
elements.colorPicker.addEventListener('change', handleColorChange);
elements.rerollBtn.addEventListener('click', handleReroll);

const defaultColor = '#' + 
    state.selectedColor.r.toString(16).padStart(2, '0') +
    state.selectedColor.g.toString(16).padStart(2, '0') +
    state.selectedColor.b.toString(16).padStart(2, '0');
elements.colorPicker.value = defaultColor;

buildQuilt();
```

}

if (document.readyState === ‘loading’) {
document.addEventListener(‘DOMContentLoaded’, init);
} else {
init();
}
