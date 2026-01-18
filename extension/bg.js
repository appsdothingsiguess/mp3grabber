const WS_URL = "ws://localhost:8787";
let sock;

// Set to track recently sent URLs for debouncing
const recentlyProcessedUrls = new Set();

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

// Clean up old URLs from the debounce set (older than 5 seconds)
function cleanupDebounceSet() {
  const now = Date.now();
  for (const [url, timestamp] of recentlyProcessedUrls.entries()) {
    if (now - timestamp > 5000) {
      recentlyProcessedUrls.delete(url);
    }
  }
}

// Network request listener for stream detection
const filter = {
  urls: ["<all_urls>"],
  types: ["xmlhttprequest", "other", "media"]
};

chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    const url = details.url.toLowerCase();
    
    // Check if URL contains .m3u8 or .mpd (HLS/DASH manifests)
    if (url.includes('.m3u8') || url.includes('.mpd')) {
      console.log('MP3 Grabber: Stream detected:', details.url);
      
      // Debounce: skip if we've recently processed this URL
      if (recentlyProcessedUrls.has(details.url)) {
        console.log('MP3 Grabber: Skipping duplicate stream (debounced):', details.url);
        return;
      }
      
      // Add to debounce set with timestamp
      recentlyProcessedUrls.add(details.url);
      setTimeout(() => recentlyProcessedUrls.delete(details.url), 5000);
      
      // Periodically clean up the debounce set
      if (recentlyProcessedUrls.size > 100) {
        cleanupDebounceSet();
      }
      
      try {
        // Get the origin URL for cookie extraction
        const urlObj = new URL(details.url);
        const originUrl = `${urlObj.protocol}//${urlObj.host}`;
        
        // Extract cookies for this domain
        console.log('MP3 Grabber: Extracting cookies for:', originUrl);
        const cookies = await chrome.cookies.getAll({ url: details.url });
        console.log(`MP3 Grabber: Found ${cookies.length} cookies`);
        
        // Ensure WebSocket connection is open
        let activeSocket;
        try {
          activeSocket = await connect();
        } catch (error) {
          console.error('MP3 Grabber: Failed to connect to relay server:', error);
          return;
        }
        
        // Send stream data to relay server
        if (activeSocket.readyState === WebSocket.OPEN) {
          const payload = {
            type: 'stream_found',
            url: details.url,
            cookies: cookies,
            source: 'sniffer',
            pageUrl: details.initiator || 'unknown',
            timestamp: Date.now()
          };
          
          const message = JSON.stringify(payload);
          activeSocket.send(message);
          console.log('MP3 Grabber: Stream data sent to relay server');
        } else {
          console.warn('MP3 Grabber: WebSocket not open, cannot send stream data');
        }
        
      } catch (error) {
        console.error('MP3 Grabber: Error processing stream:', error);
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
console.log('MP3 Grabber: Background script loaded, establishing connection...');
connect().catch(err => {
  console.error('MP3 Grabber: Initial connection failed:', err);
  console.log('MP3 Grabber: Will retry when stream is detected');
});
