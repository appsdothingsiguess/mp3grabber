const WS_URL = "ws://192.168.1.96:8787";       // ← use relay box IP
let sock;

// Establishes a WebSocket connection if one is not already open.
// Returns a promise that resolves with the open socket.
function connect() {
  if (sock?.readyState === WebSocket.OPEN) {
    console.log("MP3 Grabber: WebSocket connection already open.");
    return Promise.resolve(sock);
  }

  // If a connection is in progress, wait for it to complete.
  if (sock?.readyState === WebSocket.CONNECTING) {
    console.log("MP3 Grabber: WebSocket connection is in progress, waiting...");
    return new Promise((resolve, reject) => {
      sock.addEventListener('open', () => resolve(sock), { once: true });
      sock.addEventListener('error', (err) => reject(err), { once: true });
    });
  }

  // Create a new WebSocket connection.
  console.log("MP3 Grabber: Creating new WebSocket connection to", WS_URL);
  sock = new WebSocket(WS_URL);

  return new Promise((resolve, reject) => {
    sock.addEventListener('open', () => {
      console.log("MP3 Grabber: WebSocket connection opened.");
      // When the socket closes, nullify the sock variable to allow for reconnection.
      sock.addEventListener('close', () => {
        console.log("MP3 Grabber: WebSocket connection closed.");
        sock = null;
      }, { once: true });
      resolve(sock);
    }, { once: true });
    sock.addEventListener('error', (err) => {
      console.error("MP3 Grabber: WebSocket error.", err);
      sock = null;
      reject(err);
    }, { once: true });
  });
}

// This function is injected into the active tab to find MP3 links.
function findMp3Links() {
  const selectors = [
    'a[href$=".mp3"]',
    'audio[src$=".mp3"]',
    'source[src$=".mp3"]'
  ];
  const elements = document.querySelectorAll(selectors.join(', '));
  // The `href` or `src` property provides the absolute URL.
  return Array.from(elements).map(el => el.href || el.src);
}

chrome.commands.onCommand.addListener(async cmd => {
  console.log(`MP3 Grabber: Command received: ${cmd}`);
  if (cmd !== "grab-mp3") return;

  console.log("MP3 Grabber: 'grab-mp3' command triggered.");

  let activeSocket;
  try {
    activeSocket = await connect();
  } catch (error) {
    console.error("MP3 Grabber: WebSocket connection failed.", error);
    return;
  }

  console.log("MP3 Grabber: Querying for active tab...");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Cannot run on tabs without an ID (e.g. chrome://newtab)
  if (!tab.id) {
    console.log("MP3 Grabber: Active tab has no ID, aborting.");
    return;
  }

  console.log(`MP3 Grabber: Executing script on tab ${tab.id} (${tab.url})`);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: findMp3Links
    });

    console.log("MP3 Grabber: Script execution results:", results);

    // The result from a single frame execution is in results[0].
    if (results && results[0] && results[0].result) {
      const urls = results[0].result;
      console.log(`MP3 Grabber: Found ${urls.length} MP3 link(s).`);
      urls.forEach(url => {
        if (activeSocket.readyState === WebSocket.OPEN) {
          console.log(`MP3 Grabber: Sending URL via WebSocket: ${url}`);
          activeSocket.send(JSON.stringify({ url }));
        } else {
          console.warn(`MP3 Grabber: WebSocket not open. readyState: ${activeSocket.readyState}. Cannot send URL: ${url}`);
        }
      });
    } else {
      console.log("MP3 Grabber: No MP3 links found on the page.");
    }
  } catch (error) {
    // This can happen on restricted pages like the Chrome Web Store.
    // We can log it, but it's not a critical extension failure.
    console.info(`MP3 Grabber: Could not execute script on ${tab.url}. This is expected for some pages.`, error.message);
  }
});
