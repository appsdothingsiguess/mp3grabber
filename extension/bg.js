const WS_URL = "ws://localhost:8787";
let sock;

// Establishes a WebSocket connection if one is not already open.
// Returns a promise that resolves with the open socket.
function connect() {
  console.log(`MP3 Grabber: connect() called. Current socket state: ${sock?.readyState || 'null'}`);
  
  if (sock?.readyState === WebSocket.OPEN) {
    console.log("MP3 Grabber: WebSocket connection already open.");
    return Promise.resolve(sock);
  }

  // If a connection is in progress, wait for it to complete.
  if (sock?.readyState === WebSocket.CONNECTING) {
    console.log("MP3 Grabber: WebSocket connection is in progress, waiting...");
    return new Promise((resolve, reject) => {
      sock.addEventListener('open', () => {
        console.log("MP3 Grabber: WebSocket connection completed (waited)");
        resolve(sock);
      }, { once: true });
      sock.addEventListener('error', (err) => {
        console.error("MP3 Grabber: WebSocket connection failed (waited):", err);
        reject(err);
      }, { once: true });
    });
  }

  // Create a new WebSocket connection.
  console.log("MP3 Grabber: Creating new WebSocket connection to", WS_URL);
  sock = new WebSocket(WS_URL);

  return new Promise((resolve, reject) => {
    sock.addEventListener('open', () => {
      console.log("MP3 Grabber: WebSocket connection opened successfully");
      // When the socket closes, nullify the sock variable to allow for reconnection.
      sock.addEventListener('close', (event) => {
        console.log("MP3 Grabber: WebSocket connection closed.", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });
        sock = null;
      }, { once: true });
      resolve(sock);
    }, { once: true });
    sock.addEventListener('error', (err) => {
      console.error("MP3 Grabber: WebSocket error occurred:", err);
      console.error("MP3 Grabber: WebSocket readyState:", sock?.readyState);
      sock = null;
      reject(err);
    }, { once: true });
  });
}

// ============================================================================
// INTELLIGENT STREAM FILTERING SYSTEM
// ============================================================================

/**
 * Check if URL should be ignored based on file extension or content type
 */
function shouldIgnoreUrl(url) {
  const urlLower = url.toLowerCase();
  
  // Ignore subtitle/caption files
  if (urlLower.endsWith('.vtt') || urlLower.endsWith('.srt')) {
    console.log('🚫 [FILTER] Ignoring subtitle file:', url.substring(0, 100));
    return true;
  }
  
  // Ignore encryption keys
  if (urlLower.endsWith('.key')) {
    console.log('🚫 [FILTER] Ignoring encryption key:', url.substring(0, 100));
    return true;
  }
  
  // Ignore image files
  if (urlLower.endsWith('.png') || urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) {
    console.log('🚫 [FILTER] Ignoring image file:', url.substring(0, 100));
    return true;
  }
  
  // Ignore URLs containing specific keywords
  const ignoreKeywords = ['segment', 'fragment', 'caption', 'subtitle'];
  for (const keyword of ignoreKeywords) {
    if (urlLower.includes(keyword)) {
      console.log(`🚫 [FILTER] Ignoring URL with keyword "${keyword}":`, url.substring(0, 100));
      return true;
    }
  }
  
  return false;
}

/**
 * Determine stream quality/priority
 * Higher number = higher priority
 */
function getStreamPriority(url) {
  const urlLower = url.toLowerCase();
  
  // Master manifests have highest priority
  if (urlLower.includes('master.m3u8') || urlLower.includes('master_playlist')) {
    return 100;
  }
  
  // Index manifests have high priority
  if (urlLower.includes('index.m3u8') || urlLower.includes('playlist.m3u8')) {
    return 90;
  }
  
  // MPD manifests (DASH)
  if (urlLower.endsWith('.mpd')) {
    return 80;
  }
  
  // Regular m3u8 files
  if (urlLower.includes('.m3u8')) {
    return 50;
  }
  
  // Other formats
  return 10;
}

/**
 * Extract unique identifier from URL (for deduplication)
 */
function extractStreamId(url) {
  try {
    // Try to extract Kaltura entryId if present
    const kalturaMatch = url.match(/\/entryId\/([^\/]+)\//);
    if (kalturaMatch) {
      return `kaltura_${kalturaMatch[1]}`;
    }
    
    // Otherwise use the base URL without query params and quality indicators
    const urlObj = new URL(url);
    const pathname = urlObj.pathname
      .replace(/_(low|medium|high|[0-9]+p|[0-9]+k)/gi, '')
      .replace(/\/(low|medium|high|[0-9]+p|[0-9]+k)\//gi, '/');
    
    return `${urlObj.host}${pathname}`;
  } catch (error) {
    console.error('🚫 [FILTER] Error extracting stream ID:', error);
    return url;
  }
}

// Pending streams waiting for better quality (debounce buffer)
const pendingStreams = new Map(); // streamId -> { url, priority, timeout, cookies, details }

// Track which base URLs we've already processed (to avoid multiple quality versions)
const processedBaseUrls = new Map(); // streamId -> { url, timestamp, priority }

/**
 * Process a detected stream with intelligent debouncing
 * Waits 2 seconds to see if a better quality stream appears
 */
async function processStream(url, cookies, details) {
  const streamId = extractStreamId(url);
  const priority = getStreamPriority(url);
  
  console.log('📥 [FILTER] Stream detected:', {
    url: url.substring(0, 100) + '...',
    streamId: streamId,
    priority: priority
  });
  
  // Check if we've already processed this stream recently
  if (processedBaseUrls.has(streamId)) {
    const processed = processedBaseUrls.get(streamId);
    const timeSinceProcessed = Date.now() - processed.timestamp;
    
    if (timeSinceProcessed < 60000) { // 60 second window
      if (priority <= processed.priority) {
        console.log('⏭️  [FILTER] Skipping - already processed better or equal stream:', {
          current: priority,
          processed: processed.priority
        });
        return;
      } else {
        console.log('🔄 [FILTER] Found better quality stream, replacing:', {
          old: processed.priority,
          new: priority
        });
      }
    }
  }
  
  // Check if we have a pending stream for this ID
  if (pendingStreams.has(streamId)) {
    const pending = pendingStreams.get(streamId);
    
    if (priority > pending.priority) {
      // Found a better stream, replace it
      console.log('⬆️  [FILTER] Upgrading pending stream:', {
        oldPriority: pending.priority,
        newPriority: priority,
        oldUrl: pending.url.substring(0, 80),
        newUrl: url.substring(0, 80)
      });
      
      // Cancel old timeout
      clearTimeout(pending.timeout);
      
      // Set new pending stream with 2-second debounce
      const timeout = setTimeout(() => {
        sendStreamToRelay(streamId, url, cookies, details);
      }, 2000);
      
      pendingStreams.set(streamId, {
        url: url,
        priority: priority,
        timeout: timeout,
        cookies: cookies,
        details: details
      });
    } else {
      console.log('⏭️  [FILTER] Pending stream is better quality, ignoring:', {
        pending: pending.priority,
        new: priority
      });
    }
  } else {
    // New stream, add to pending with 2-second debounce
    console.log('⏳ [FILTER] Adding to pending queue (2s debounce):', {
      streamId: streamId,
      priority: priority
    });
    
    const timeout = setTimeout(() => {
      sendStreamToRelay(streamId, url, cookies, details);
    }, 2000);
    
    pendingStreams.set(streamId, {
      url: url,
      priority: priority,
      timeout: timeout,
      cookies: cookies,
      details: details
    });
  }
}

/**
 * Send stream to relay server after debounce period
 */
async function sendStreamToRelay(streamId, url, cookies, details) {
  console.log('🚀 [FILTER] Sending stream to relay (debounce complete):', {
    streamId: streamId,
    url: url.substring(0, 100) + '...'
  });
  
  // Remove from pending
  pendingStreams.delete(streamId);
  
  // Mark as processed
  processedBaseUrls.set(streamId, {
    url: url,
    timestamp: Date.now(),
    priority: getStreamPriority(url)
  });
  
  try {
    // Ensure WebSocket connection is open
    let activeSocket;
    try {
      activeSocket = await connect();
    } catch (error) {
      console.error('❌ [FILTER] Failed to connect to relay server:', error);
      return;
    }
    
    // Send stream data to relay server
    if (activeSocket.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'stream_found',
        url: url,
        cookies: cookies,
        source: 'sniffer',
        pageUrl: details.initiator || 'unknown',
        timestamp: Date.now()
      };
      
      const message = JSON.stringify(payload);
      activeSocket.send(message);
      console.log('✅ [FILTER] Stream sent to relay server');
    } else {
      console.warn('⚠️  [FILTER] WebSocket not open, cannot send stream data');
    }
    
  } catch (error) {
    console.error('❌ [FILTER] Error sending stream to relay:', error);
  }
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  
  // Clean up processed URLs older than 5 minutes
  for (const [streamId, data] of processedBaseUrls.entries()) {
    if (now - data.timestamp > 300000) {
      processedBaseUrls.delete(streamId);
    }
  }
  
  console.log('🧹 [FILTER] Cleanup complete:', {
    processed: processedBaseUrls.size,
    pending: pendingStreams.size
  });
}, 60000); // Every minute

// Network request listener for stream detection
const filter = {
  urls: ["<all_urls>"],
  types: ["xmlhttprequest", "other", "media"]
};

chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    const url = details.url;
    const urlLower = url.toLowerCase();
    
    // Check if URL contains .m3u8 or .mpd (HLS/DASH manifests)
    if (urlLower.includes('.m3u8') || urlLower.endsWith('.mpd')) {
      
      // STEP 1: Apply ignore filters
      if (shouldIgnoreUrl(url)) {
        return; // Filtered out, don't process
      }
      
      console.log('🎯 [FILTER] Valid stream detected:', url.substring(0, 100) + '...');
      
      try {
        // Extract cookies for this domain
        const cookies = await chrome.cookies.getAll({ url: url });
        console.log(`🍪 [FILTER] Found ${cookies.length} cookies`);
        
        // STEP 2: Process with intelligent debouncing and prioritization
        await processStream(url, cookies, details);
        
      } catch (error) {
        console.error('❌ [FILTER] Error processing stream:', error);
      }
    }
  },
  filter
);

// Optional: Manual trigger via keyboard shortcut (can be used to force reconnect)
chrome.commands.onCommand.addListener(async (cmd) => {
  console.log(`MP3 Grabber: Command received: ${cmd}`);
  
  if (cmd === "grab-mp3") {
    console.log("MP3 Grabber: Manual trigger - ensuring WebSocket connection");
    
    try {
      const activeSocket = await connect();
      console.log("MP3 Grabber: WebSocket connection verified, readyState:", activeSocket.readyState);
      
      // Send a ping message to verify connection
      if (activeSocket.readyState === WebSocket.OPEN) {
        activeSocket.send(JSON.stringify({ 
          type: 'ping', 
          timestamp: Date.now() 
        }));
        console.log("MP3 Grabber: Ping sent to relay server");
      }
    } catch (error) {
      console.error("MP3 Grabber: Failed to connect to relay server:", error);
    }
  }
});

// Establish connection on extension load
console.log('=' .repeat(70));
console.log('🎵 MP3 Grabber: Background script loaded');
console.log('🔍 Intelligent Stream Filtering: ACTIVE');
console.log('📊 Filters:');
console.log('   - Ignoring: .vtt, .srt, .key, .png, .jpg');
console.log('   - Ignoring: segment, fragment, caption URLs');
console.log('   - Prioritizing: master.m3u8, index.m3u8');
console.log('   - Debounce: 2-second wait for better streams');
console.log('=' .repeat(70));
console.log('🔌 Establishing WebSocket connection...');
connect().catch(err => {
  console.error('❌ Initial connection failed:', err);
  console.log('🔄 Will retry when stream is detected');
});
