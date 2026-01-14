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
const CONCURRENT_FETCHES = 6;      // Number of concurrent image fetches
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
selectedColor: { r: 230, g: 57, b: 70 },  // Default: #e63946
tiles: [],
isLoading: false,
colorAnalysisCache: new Map(),  // Cache color analysis results
continueToken: null,            // For API pagination
abortController: null           // For canceling ongoing fetches
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

/**

- Convert hex color string to RGB object
  */
  function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
  r: parseInt(result[1], 16),
  g: parseInt(result[2], 16),
  b: parseInt(result[3], 16)
  } : null;
  }

/**

- Calculate Euclidean distance between two RGB colors
  */
  function colorDistance(c1, c2) {
  return Math.sqrt(
  Math.pow(c1.r - c2.r, 2) +
  Math.pow(c1.g - c2.g, 2) +
  Math.pow(c1.b - c2.b, 2)
  );
  }

/**

- Truncate text to a maximum length
  */
  function truncate(str, maxLength) {
  if (!str) return ‘’;
  return str.length > maxLength ? str.slice(0, maxLength - 1) + ‘…’ : str;
  }

/**

- Extract filename from Wikimedia title
  */
  function extractFilename(title) {
  // Remove “File:” prefix and extension
  let name = title.replace(/^File:/, ‘’).replace(/.[^/.]+$/, ‘’);
  // Replace underscores with spaces
  name = name.replace(/_/g, ’ ’);
  return truncate(name, 60);
  }

/**

- Show a message to the user
  */
  function showMessage(text, duration = 5000) {
  elements.messageText.textContent = text;
  elements.messageDisplay.classList.remove(‘hidden’);
  
  setTimeout(() => {
  elements.messageDisplay.classList.add(‘hidden’);
  }, duration);
  }

/**

- Update loading progress display
  */
  function updateProgress(current, total) {
  elements.loadingProgress.textContent = `${current} / ${total} tiles`;
  }

/**

- Show/hide loading overlay
  */
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

/**

- Fetch random images from Wikimedia Commons API
- Uses the query generator to get random files with image info
  */
  async function fetchRandomImages(count = BATCH_SIZE) {
  const params = new URLSearchParams({
  action: ‘query’,
  format: ‘json’,
  origin: ’*’,
  generator: ‘random’,
  grnnamespace: ‘6’,  // File namespace
  grnlimit: count.toString(),
  prop: ‘imageinfo|categories’,
  iiprop: ‘url|extmetadata|mime’,
  iiurlwidth: THUMB_WIDTH.toString(),
  cllimit: ‘5’  // Limit categories to check for non-free
  });
  
  try {
  const response = await fetch(`${COMMONS_API}?${params}`);
  if (!response.ok) throw new Error(‘API request failed’);
  
  ```
   const data = await response.json();
   
   if (!data.query || !data.query.pages) {
       return [];
   }
  
   // Process and filter images
   const images = Object.values(data.query.pages)
       .filter(page => {
           // Must have image info
           if (!page.imageinfo || !page.imageinfo[0]) return false;
           
           const info = page.imageinfo[0];
           
           // Must be an actual image
           if (!info.mime || !info.mime.startsWith('image/')) return false;
           
           // Must have a thumbnail URL
           if (!info.thumburl) return false;
           
           // Skip SVGs (often logos/icons, harder to color match)
           if (info.mime === 'image/svg+xml') return false;
           
           return true;
       })
       .map(page => {
           const info = page.imageinfo[0];
           const meta = info.extmetadata || {};
           
           return {
               title: page.title,
               displayName: extractFilename(page.title),
               thumbUrl: info.thumburl,
               fullUrl: info.url,
               descriptionUrl: info.descriptionurl || `${COMMONS_FILE_BASE}${encodeURIComponent(page.title)}`,
               author: meta.Artist?.value?.replace(/<[^>]*>/g, '') || 'Unknown',
               license: meta.LicenseShortName?.value || meta.License?.value || 'Unknown license',
               width: info.thumbwidth,
               height: info.thumbheight
           };
       });
  
   return images;
  ```
  
  } catch (error) {
  console.error(‘Error fetching images:’, error);
  return [];
  }
  }

// ============================================
// COLOR ANALYSIS FUNCTIONS
// ============================================

/**

- Load an image and return it as an Image element
- Uses crossOrigin to enable canvas operations
  */
  function loadImage(url) {
  return new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = ‘anonymous’;
  
  ```
   img.onload = () => resolve(img);
   img.onerror = () => reject(new Error('Image load failed'));
   
   // Add cache-busting to avoid CORS issues with cached images
   const separator = url.includes('?') ? '&' : '?';
   img.src = `${url}${separator}origin=wikiquilt`;
  ```
  
  });
  }

/**

- Analyze an image to determine if it contains the target color
- Uses stride sampling for performance
- Returns true if the image passes the color filter
  */
  async function analyzeImageColor(imageUrl, targetColor) {
  // Check cache first
  const cacheKey = `${imageUrl}_${targetColor.r}_${targetColor.g}_${targetColor.b}`;
  if (state.colorAnalysisCache.has(cacheKey)) {
  return state.colorAnalysisCache.get(cacheKey);
  }
  
  try {
  const img = await loadImage(imageUrl);
  
  ```
   // Create offscreen canvas
   const canvas = document.createElement('canvas');
   const ctx = canvas.getContext('2d', { willReadFrequently: true });
   
   // Use smaller size for faster analysis
   const maxSize = 100;
   const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
   canvas.width = Math.floor(img.width * scale);
   canvas.height = Math.floor(img.height * scale);
   
   // Draw image
   ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
   
   // Get image data
   let imageData;
   try {
       imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
   } catch (e) {
       // Canvas tainted - CORS issue
       console.warn('Canvas tainted, skipping image:', imageUrl);
       state.colorAnalysisCache.set(cacheKey, false);
       return false;
   }
   
   const pixels = imageData.data;
   let matchingPixels = 0;
   let sampledPixels = 0;
   
   // Stride sampling
   for (let i = 0; i < pixels.length; i += 4 * SAMPLE_STRIDE) {
       const pixelColor = {
           r: pixels[i],
           g: pixels[i + 1],
           b: pixels[i + 2]
       };
       
       // Skip fully transparent pixels
       if (pixels[i + 3] < 128) continue;
       
       sampledPixels++;
       
       if (colorDistance(pixelColor, targetColor) <= COLOR_TOLERANCE) {
           matchingPixels++;
       }
   }
   
   const matchPercent = sampledPixels > 0 ? (matchingPixels / sampledPixels) * 100 : 0;
   const passes = matchPercent >= MIN_MATCH_PERCENT;
   
   // Cache result
   state.colorAnalysisCache.set(cacheKey, passes);
   
   return passes;
  ```
  
  } catch (error) {
  console.warn(‘Color analysis failed:’, error.message);
  state.colorAnalysisCache.set(cacheKey, false);
  return false;
  }
  }

// ============================================
// TILE CREATION & RENDERING
// ============================================

/**

- Create a tile element for the quilt grid
  */
  function createTileElement(imageData) {
  const tile = document.createElement(‘article’);
  tile.className = ‘quilt-tile’;
  tile.tabIndex = 0;
  
  // Create image
  const img = document.createElement(‘img’);
  img.className = ‘tile-image’;
  img.src = imageData.thumbUrl;
  img.alt = imageData.displayName;
  img.loading = ‘lazy’;
  
  // Create attribution overlay
  const attribution = document.createElement(‘div’);
  attribution.className = ‘tile-attribution’;
  attribution.innerHTML = `<h3 class="tile-title">${escapeHtml(imageData.displayName)}</h3> <div class="tile-meta"> <span class="tile-author">${escapeHtml(truncate(imageData.author, 30))}</span> <span class="tile-license">${escapeHtml(truncate(imageData.license, 20))}</span> </div>`;
  
  tile.appendChild(img);
  tile.appendChild(attribution);
  
  // Click handler - open Wikimedia Commons page
  tile.addEventListener(‘click’, () => {
  window.open(imageData.descriptionUrl, ‘_blank’, ‘noopener,noreferrer’);
  });
  
  // Keyboard handler
  tile.addEventListener(‘keydown’, (e) => {
  if (e.key === ‘Enter’ || e.key === ’ ’) {
  e.preventDefault();
  window.open(imageData.descriptionUrl, ‘_blank’, ‘noopener,noreferrer’);
  }
  });
  
  return tile;
  }

/**

- Escape HTML entities to prevent XSS
  */
  function escapeHtml(text) {
  const div = document.createElement(‘div’);
  div.textContent = text;
  return div.innerHTML;
  }

/**

- Clear the quilt grid
  */
  function clearGrid() {
  elements.quiltGrid.innerHTML = ‘’;
  state.tiles = [];
  }

/**

- Add a tile to the grid
  */
  function addTileToGrid(imageData) {
  const tile = createTileElement(imageData);
  elements.quiltGrid.appendChild(tile);
  state.tiles.push(imageData);
  }

// ============================================
// MAIN QUILT BUILDING LOGIC
// ============================================

/**

- Build the quilt by fetching and displaying images
- Handles both filtered and unfiltered modes
  */
  async function buildQuilt() {
  // Cancel any ongoing fetch
  if (state.abortController) {
  state.abortController.abort();
  }
  state.abortController = new AbortController();
  
  clearGrid();
  setLoading(true);
  updateProgress(0, TARGET_TILES);
  
  const targetColor = state.colorFilterEnabled ? state.selectedColor : null;
  let attempts = 0;
  let consecutiveFailures = 0;
  
  try {
  while (state.tiles.length < TARGET_TILES && attempts < MAX_ATTEMPTS) {
  // Check if we should abort
  if (state.abortController.signal.aborted) {
  console.log(‘Quilt building aborted’);
  return;
  }
  
  ```
       // Fetch a batch of candidate images
       const candidates = await fetchRandomImages(BATCH_SIZE);
       attempts++;
       
       if (candidates.length === 0) {
           consecutiveFailures++;
           if (consecutiveFailures > 10) {
               showMessage('Having trouble connecting to Wikimedia. Please try again.');
               break;
           }
           continue;
       }
       
       consecutiveFailures = 0;
       
       // Process candidates
       const processingPromises = candidates.map(async (imageData) => {
           // If color filter is enabled, analyze the image
           if (targetColor) {
               const passes = await analyzeImageColor(imageData.thumbUrl, targetColor);
               if (!passes) return null;
           }
           return imageData;
       });
       
       // Wait for all analyses to complete
       const results = await Promise.all(processingPromises);
       
       // Add passing images to the grid
       for (const imageData of results) {
           if (imageData && state.tiles.length < TARGET_TILES) {
               addTileToGrid(imageData);
               updateProgress(state.tiles.length, TARGET_TILES);
           }
       }
   }
   
   // Check if we got enough tiles
   if (state.tiles.length < TARGET_TILES && targetColor) {
       if (state.tiles.length === 0) {
           showMessage(`No images found with that color. Try a different shade!`);
       } else if (state.tiles.length < TARGET_TILES / 2) {
           showMessage(`Found ${state.tiles.length} matching images. Try a more common color for more results.`);
       }
   }
  ```
  
  } catch (error) {
  if (error.name !== ‘AbortError’) {
  console.error(‘Error building quilt:’, error);
  showMessage(‘Something went wrong. Please try again.’);
  }
  } finally {
  setLoading(false);
  }
  }

// ============================================
// EVENT HANDLERS
// ============================================

/**

- Handle color toggle change
  */
  function handleColorToggle(event) {
  state.colorFilterEnabled = event.target.checked;
  elements.colorPicker.disabled = !state.colorFilterEnabled;
  
  // Rebuild quilt with new settings
  buildQuilt();
  }

/**

- Handle color picker change
  */
  function handleColorChange(event) {
  const rgb = hexToRgb(event.target.value);
  if (rgb) {
  state.selectedColor = rgb;
  
  ```
   // Only rebuild if color filter is enabled
   if (state.colorFilterEnabled) {
       buildQuilt();
   }
  ```
  
  }
  }

/**

- Handle re-roll button click
  */
  function handleReroll() {
  // Clear the color analysis cache to get fresh results
  state.colorAnalysisCache.clear();
  buildQuilt();
  }

// ============================================
// INITIALIZATION
// ============================================

/**

- Initialize the application
  */
  function init() {
  // Set up event listeners
  elements.colorToggle.addEventListener(‘change’, handleColorToggle);
  elements.colorPicker.addEventListener(‘change’, handleColorChange);
  elements.rerollBtn.addEventListener(‘click’, handleReroll);
  
  // Initialize color picker with default color
  const defaultColor = ‘#’ +
  state.selectedColor.r.toString(16).padStart(2, ‘0’) +
  state.selectedColor.g.toString(16).padStart(2, ‘0’) +
  state.selectedColor.b.toString(16).padStart(2, ‘0’);
  elements.colorPicker.value = defaultColor;
  
  // Build initial quilt
  buildQuilt();
  }

// Start the app when DOM is ready
if (document.readyState === ‘loading’) {
document.addEventListener(‘DOMContentLoaded’, init);
} else {
init();
}
