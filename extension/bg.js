const WS_URL = "ws://localhost:8787";       // ← use localhost for local development
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

// This function is injected into the active tab to find audio links.
function findAudioLinks() {
  console.log("MP3 Grabber: findAudioLinks() executed on page:", window.location.href);
  
  const selectors = [
    'a[href$=".mp3"]',
    'a[href$=".m4a"]',
    'a[href$=".wav"]',
    'a[href$=".flac"]',
    'a[href$=".ogg"]',
    'a[href$=".webm"]',
    'audio[src$=".mp3"]',
    'audio[src$=".m4a"]',
    'audio[src$=".wav"]',
    'audio[src$=".flac"]',
    'audio[src$=".ogg"]',
    'audio[src$=".webm"]',
    'source[src$=".mp3"]',
    'source[src$=".m4a"]',
    'source[src$=".wav"]',
    'source[src$=".flac"]',
    'source[src$=".ogg"]',
    'source[src$=".webm"]'
  ];
  
  console.log("MP3 Grabber: Searching for selectors:", selectors);
  const elements = document.querySelectorAll(selectors.join(', '));
  console.log(`MP3 Grabber: Found ${elements.length} elements matching audio selectors`);
  
  // The `href` or `src` property provides the absolute URL.
  const urls = Array.from(elements).map(el => {
    const url = el.href || el.src;
    console.log(`MP3 Grabber: Found audio element:`, {
      tagName: el.tagName,
      url: url,
      href: el.href,
      src: el.src
    });
    return url;
  });
  
  console.log(`MP3 Grabber: Returning ${urls.length} audio URLs:`, urls);
  return urls;
}

// YouTube-specific function to find audio/video elements
function findYouTubeAudioLinks() {
  console.log("MP3 Grabber: findYouTubeAudioLinks() executed on YouTube page");
  
  const audioUrls = [];
  
  try {
    // Look for video elements (YouTube uses video elements for audio/video)
    const videoElements = document.querySelectorAll('video');
    console.log(`MP3 Grabber: Found ${videoElements.length} video elements`);
    
    videoElements.forEach((video, index) => {
      if (video.src) {
        console.log(`MP3 Grabber: Video element ${index + 1} src:`, video.src);
        audioUrls.push(video.src);
      }
      
      // Check for source elements within video
      const sources = video.querySelectorAll('source');
      sources.forEach((source, sourceIndex) => {
        if (source.src) {
          console.log(`MP3 Grabber: Source element ${sourceIndex + 1} src:`, source.src);
          audioUrls.push(source.src);
        }
      });
    });
    
    // Look for YouTube's internal video player data
    const videoPlayer = document.querySelector('#movie_player, .html5-video-player');
    if (videoPlayer) {
      console.log('MP3 Grabber: Found YouTube video player');
      
      // Try to access YouTube's internal video data
      try {
        const videoData = window.ytplayer?.config?.args || 
                         window.ytInitialPlayerResponse ||
                         window.ytInitialData;
        
        if (videoData) {
          console.log('MP3 Grabber: Found YouTube video data');
          
          // Extract video URLs from YouTube's data structure
          if (videoData.streamingData && videoData.streamingData.formats) {
            videoData.streamingData.formats.forEach((format, index) => {
              if (format.url) {
                console.log(`MP3 Grabber: YouTube format ${index + 1} URL:`, format.url);
                audioUrls.push(format.url);
              }
            });
          }
          
          if (videoData.streamingData && videoData.streamingData.adaptiveFormats) {
            videoData.streamingData.adaptiveFormats.forEach((format, index) => {
              if (format.url) {
                console.log(`MP3 Grabber: YouTube adaptive format ${index + 1} URL:`, format.url);
                audioUrls.push(format.url);
              }
            });
          }
        }
      } catch (error) {
        console.log('MP3 Grabber: Could not access YouTube internal data:', error.message);
      }
    }
    
    // Look for blob URLs (YouTube often uses these)
    const allElements = document.querySelectorAll('*');
    allElements.forEach((element) => {
      ['src', 'href'].forEach(attr => {
        const url = element[attr];
        if (url && url.startsWith('blob:')) {
          console.log(`MP3 Grabber: Found blob URL:`, url);
          audioUrls.push(url);
        }
      });
    });
    
  } catch (error) {
    console.error('MP3 Grabber: Error searching for YouTube audio elements:', error);
  }
  
  // Remove duplicates and filter valid URLs
  const uniqueUrls = [...new Set(audioUrls)].filter(url => {
    return url && (
      url.includes('youtube.com') || 
      url.includes('googlevideo.com') ||
      url.startsWith('blob:') ||
      url.match(/\.(mp3|m4a|wav|flac|ogg|webm)(\?|$)/i)
    );
  });
  
  console.log(`MP3 Grabber: Found ${uniqueUrls.length} unique YouTube audio/video URLs:`, uniqueUrls);
  return uniqueUrls;
}

chrome.commands.onCommand.addListener(async cmd => {
  console.log(`MP3 Grabber: Command received: ${cmd}`);
  if (cmd !== "grab-mp3") {
    console.log(`MP3 Grabber: Ignoring command: ${cmd}`);
    return;
  }

  console.log("MP3 Grabber: 'grab-mp3' command triggered.");

  let activeSocket;
  try {
    console.log("MP3 Grabber: Attempting to connect to WebSocket...");
    activeSocket = await connect();
    console.log("MP3 Grabber: WebSocket connection successful, readyState:", activeSocket.readyState);
  } catch (error) {
    console.error("MP3 Grabber: WebSocket connection failed:", error);
    console.error("MP3 Grabber: Error details:", {
      message: error.message,
      type: error.type,
      target: error.target?.readyState
    });
    return;
  }

  console.log("MP3 Grabber: Querying for active tab...");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log("MP3 Grabber: Active tab found:", {
    id: tab.id,
    url: tab.url,
    title: tab.title
  });

  // Cannot run on tabs without an ID (e.g. chrome://newtab)
  if (!tab.id) {
    console.log("MP3 Grabber: Active tab has no ID, aborting.");
    return;
  }

  // Check if this is a YouTube page
  const isYouTube = tab.url && (tab.url.includes('youtube.com') || tab.url.includes('youtu.be'));
  
  console.log(`MP3 Grabber: Executing script on tab ${tab.id} (${tab.url})`);
  console.log(`MP3 Grabber: Is YouTube page: ${isYouTube}`);
  
  try {
    let results;
    
    if (isYouTube) {
      // For YouTube pages, try to use the content script first
      console.log("MP3 Grabber: Attempting to communicate with YouTube content script...");
      console.log("MP3 Grabber: Tab ID:", tab.id);
      console.log("MP3 Grabber: Tab URL:", tab.url);
      
      try {
        // Inject content script and communicate immediately
        console.log("MP3 Grabber: Injecting content script...");
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        console.log("MP3 Grabber: Content script injected successfully");
        
        // Wait briefly for script to initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Send message to content script
        console.log("MP3 Grabber: Sending message to content script...");
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'findAudioLinks' });
        console.log("MP3 Grabber: Content script response:", response);
        
        if (response && response.success && response.audioData) {
          console.log("MP3 Grabber: Content script succeeded, using its data");
          results = [{ result: response.audioData }];
        } else {
          // Fallback to injected script
          console.log("MP3 Grabber: Content script failed, falling back to injected script...");
          console.log("MP3 Grabber: Response was:", response);
          results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: findYouTubeAudioLinks
          });
        }
      } catch (contentScriptError) {
        console.log("MP3 Grabber: Content script communication failed, using injected script");
        console.log("MP3 Grabber: Error details:", contentScriptError);
        console.log("MP3 Grabber: Error message:", contentScriptError.message);
        console.log("MP3 Grabber: Error name:", contentScriptError.name);
        results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: findYouTubeAudioLinks
        });
      }
    } else {
      // For non-YouTube pages, use the original method
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: findAudioLinks
      });
    }

    console.log("MP3 Grabber: Script execution results:", results);

    // The result from a single frame execution is in results[0].
    if (results && results[0] && results[0].result) {
      const audioData = results[0].result;
      console.log(`MP3 Grabber: Found ${audioData.length} audio element(s):`, audioData);
      
      if (audioData.length === 0) {
        console.log("MP3 Grabber: No audio elements found on the page.");
        if (isYouTube) {
          console.log("MP3 Grabber: YouTube-specific issues:");
          console.log("  - YouTube may have updated their player structure");
          console.log("  - Video may not be fully loaded yet");
          console.log("  - YouTube's CSP may be blocking access");
          console.log("  - Try refreshing the page and waiting for video to load");
        } else {
          console.log("MP3 Grabber: This might be because:");
          console.log("  - The page doesn't contain direct audio file links");
          console.log("  - Audio files are loaded dynamically via JavaScript");
          console.log("  - The audio is embedded in a different format");
        }
        return;
      }
      
      // Process audio data sequentially to handle blob-url conversions
      for (let index = 0; index < audioData.length; index++) {
        const item = audioData[index];
        console.log(`MP3 Grabber: Processing audio element ${index + 1}/${audioData.length}:`, item);
        
        if (activeSocket.readyState === WebSocket.OPEN) {
          let message;
          
          if (item.type === 'blob') {
            // Send blob data directly
            message = JSON.stringify({ 
              type: 'blob',
              data: item.data,
              mimeType: item.mimeType,
              size: item.size,
              originalUrl: item.originalUrl,
              element: item.element,
              source: isYouTube ? 'youtube' : 'web',
              pageUrl: tab.url,
              timestamp: Date.now()
            });
            console.log(`MP3 Grabber: Sending blob data (${item.size} bytes, ${item.mimeType})`);
          } else if (item.type === 'url') {
            // Send regular URL
            message = JSON.stringify({ 
              type: 'url',
              url: item.url,
              element: item.element,
              quality: item.quality,
              source: isYouTube ? 'youtube' : 'web',
              pageUrl: tab.url,
              timestamp: Date.now()
            });
            console.log(`MP3 Grabber: Sending URL: ${item.url}`);
          }
          
          if (message) {
            activeSocket.send(message);
            console.log(`MP3 Grabber: Message sent successfully`);
          }
        } else {
          console.warn(`MP3 Grabber: WebSocket not open. readyState: ${activeSocket.readyState}. Cannot send audio element:`, item);
        }
      }
    } else {
      console.log("MP3 Grabber: No audio elements found on the page.");
      console.log("MP3 Grabber: Script execution returned:", results);
    }
  } catch (error) {
    // This can happen on restricted pages like the Chrome Web Store.
    // We can log it, but it's not a critical extension failure.
    console.info(`MP3 Grabber: Could not execute script on ${tab.url}. This is expected for some pages.`, error.message);
    console.info(`MP3 Grabber: Error details:`, error);
  }
});
