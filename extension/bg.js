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

  console.log(`MP3 Grabber: Executing script on tab ${tab.id} (${tab.url})`);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: findAudioLinks
    });

    console.log("MP3 Grabber: Script execution results:", results);

    // The result from a single frame execution is in results[0].
    if (results && results[0] && results[0].result) {
      const urls = results[0].result;
      console.log(`MP3 Grabber: Found ${urls.length} audio link(s):`, urls);
      
      if (urls.length === 0) {
        console.log("MP3 Grabber: No audio links found on the page.");
        console.log("MP3 Grabber: This might be because:");
        console.log("  - The page doesn't contain direct audio file links");
        console.log("  - Audio files are loaded dynamically via JavaScript");
        console.log("  - The audio is embedded in a different format");
        return;
      }
      
      urls.forEach((url, index) => {
        console.log(`MP3 Grabber: Processing URL ${index + 1}/${urls.length}: ${url}`);
        if (activeSocket.readyState === WebSocket.OPEN) {
          console.log(`MP3 Grabber: Sending URL via WebSocket: ${url}`);
          const message = JSON.stringify({ url });
          console.log(`MP3 Grabber: Sending message: ${message}`);
          activeSocket.send(message);
          console.log(`MP3 Grabber: Message sent successfully`);
        } else {
          console.warn(`MP3 Grabber: WebSocket not open. readyState: ${activeSocket.readyState}. Cannot send URL: ${url}`);
        }
      });
    } else {
      console.log("MP3 Grabber: No audio links found on the page.");
      console.log("MP3 Grabber: Script execution returned:", results);
    }
  } catch (error) {
    // This can happen on restricted pages like the Chrome Web Store.
    // We can log it, but it's not a critical extension failure.
    console.info(`MP3 Grabber: Could not execute script on ${tab.url}. This is expected for some pages.`, error.message);
    console.info(`MP3 Grabber: Error details:`, error);
  }
});
