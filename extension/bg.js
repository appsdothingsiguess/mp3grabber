console.log("Service Worker starting up.");

const WS_URL = "ws://192.168.1.96:8787";       // ← use relay box IP
let ws;
// Map to associate a job ID with the tab that started it.
let jobTabMap = {}; // { jobId: tabId }
let answerStore = {}; // { tabId: { taskType, answers } }
let logStore = {}; // { jobId: [{ timestamp, source, message }] }
let lastJobId = null;

let creatingOffscreen; // A global promise to avoid race conditions
async function ensureOffscreen() {
    console.log("ensureOffscreen: Ensuring a fresh offscreen document is available.");
    if (await chrome.offscreen.hasDocument()) {
        console.log("ensureOffscreen: Closing existing offscreen document.");
        await chrome.offscreen.closeDocument();
    }
    
    console.log("ensureOffscreen: Creating new offscreen document.");
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'To create blob URLs for downloading files.',
    });
}

function connectWS() {
    console.log("connectWS: Attempting to connect to WebSocket at", WS_URL);
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log("Service Worker: WebSocket connection established.");
    };

    ws.onmessage = (event) => {
        console.log("Service Worker: Received message from relay:", event.data);
        try {
            const data = JSON.parse(event.data);
            
            // Centralized log handling from relay
            if (data.type === 'log' && data.id) {
                addLog(data.id, 'Relay', data.message);
                return; // Stop processing after logging
            }

            switch (data.type) {
                case 'answer':
                    handleAnswer(data);
                    break;
                case 'gemini_failed':
                    console.warn("Received Gemini failure notice. Processing raw transcript instead.", data.payload.error);
                    processFinalTranscript(data.payload, "Gemini failed. Raw transcript saved.");
                    break;
                case 'transcription_done':
                    processFinalTranscript(data.payload, "Transcript copied & saved!");
                    break;
                case 'new_transcription':
                    // This is handled by the viewer, no action needed in bg script.
                    break;
                default:
                    console.warn("Received unknown message type from relay:", data.type);
            }
        } catch (e) {
            console.error("Service Worker: Error parsing incoming JSON message:", e);
        }
    };

    ws.onclose = () => {
        console.log("connectWS: WebSocket disconnected. Reconnecting in 2 seconds...");
        ws = null;
        setTimeout(connectWS, 2000);
    };

    ws.onerror = () => {
        console.error("connectWS: WebSocket connection failed. The relay server may be offline.");
    };
}

// This function now handles all successful answer packets from the relay.
async function handleAnswer(data) {
    console.log(`Service Worker: Handling answer for job ${data.id}. Task: "${data.taskType}". Answers: ${data.answers.length}`);
    const { taskType, answers } = data;
    const tabId = jobTabMap[data.id];

    if (answers && answers.length > 0) {
        // Store the answers AND the taskType for sequential pasting.
        answerStore[tabId] = { taskType, answers };
        addLog(data.id, 'Service Worker', 'Answers stored for pasting.');
        showToast(`Answers ready! Press Ctrl+Shift+L. (${answers.length} left)`, tabId);

        // Also perform the copy/download of the formatted text.
        const formattedText = answers.join(taskType === 'true-false' ? ', ' : '\n');
        try {
            await ensureOffscreen();
            const response = await chrome.runtime.sendMessage({
                action: "process-for-download",
                target: "offscreen",
                text: formattedText
            });
            if (response?.blobUrl) {
                chrome.downloads.download({
                    url: response.blobUrl,
                    filename: `transcripts/${data.id}.txt`
                }, () => {
                    chrome.runtime.sendMessage({ action: 'revoke-url', target: 'offscreen', url: response.blobUrl });
                    addLog(data.id, 'Service Worker', 'Download initiated for formatted answer text.');
                });
            }
        } catch(e) {
            console.error("Service Worker: Failed to copy or download formatted text.", e);
        }
    } else {
        console.warn(`Service Worker: Response for job ${data.id} contained no answers.`);
        showToast("Received an empty answer.", tabId);
    }
    delete jobTabMap[data.id]; // Clean up the map
}

// Handles a raw transcript (either from a Gemini failure or normal operation)
async function processFinalTranscript(payload, toastMessage) {
    console.log(`processFinalTranscript: Handling transcript for job ID: ${payload.id}`);
    const transcriptText = payload.transcript?.text;
    const tabId = jobTabMap[payload.id];
    
    if (transcriptText) {
        try {
            await ensureOffscreen();
            console.log("processFinalTranscript: Requesting Blob URL from offscreen document.");
            const response = await chrome.runtime.sendMessage({
                action: "process-for-download",
                target: "offscreen",
                text: transcriptText
            });

            if (response?.blobUrl) {
                console.log("processFinalTranscript: Received Blob URL, initiating download.");
                chrome.downloads.download({
                    url: response.blobUrl,
                    filename: `transcripts/${payload.id}.txt`
                }, () => {
                    // Send a message back to revoke the URL after the download starts.
                    chrome.runtime.sendMessage({ action: 'revoke-url', target: 'offscreen', url: response.blobUrl });
                });
                showToast(toastMessage, tabId);
            } else {
                throw new Error(response?.message || "Offscreen document failed to create Blob URL.");
            }
        } catch (e) {
            console.error("processFinalTranscript: Failed to process data in offscreen document:", e);
            showToast("Error: Failed to save transcript.", tabId);
        }
    } else {
        console.warn("processFinalTranscript: Payload did not contain any transcript text.", payload);
        showToast("Error: Received empty transcript.", tabId);
    }
    delete jobTabMap[payload.id]; // Clean up the map
}

async function showToast(message, tabId) {
    console.log(`showToast: Preparing to send message: "${message}" to tab ${tabId}`);
    
    if (!tabId) {
        console.warn("showToast: No valid tab ID provided. Cannot show toast.");
        return;
    }

    try {
        // Ping the content script to see if it's alive.
        const response = await chrome.tabs.sendMessage(tabId, { action: "ping" });
        if (response?.status === "pong") {
            console.log("showToast: Content script is active. Sending message.");
            chrome.tabs.sendMessage(tabId, { action: "showToast", message });
            return;
        }
    } catch (e) {
        // This error is expected if the content script is not injected.
        console.log("showToast: Content script not found on tab. Injecting now.");
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });
            // After injecting, send the message.
            console.log("showToast: Injection successful. Sending message.");
            chrome.tabs.sendMessage(tabId, { action: "showToast", message });
        } catch (injectionError) {
            console.error(`showToast: Failed to inject content script on tab ${tabId}:`, injectionError);
        }
    }
}

// Initiate the connection when the worker starts.
connectWS();

// This function is injected into the active tab to find MP3 links.
function findMp3Links() {
    const audioElements = document.querySelectorAll('audio');
    const links = Array.from(document.querySelectorAll('a'));
    
    let mp3Urls = [];

    // 1. Check <audio> tags with <source> children
    audioElements.forEach(audio => {
        const sources = audio.querySelectorAll('source');
        sources.forEach(source => {
            if (source.src && source.src.endsWith('.mp3')) {
                mp3Urls.push(source.src);
            }
        });
        // 2. Check <audio> tags with a direct src attribute
        if(audio.src && audio.src.endsWith('.mp3')) {
            mp3Urls.push(audio.src);
        }
    });

    // 3. Check <a> tags
    links.forEach(link => {
        if (link.href && link.href.endsWith('.mp3')) {
            mp3Urls.push(link.href);
        }
    });

    // Return a unique set of URLs
    return [...new Set(mp3Urls)];
}

chrome.commands.onCommand.addListener(async cmd => {
    console.log(`Service Worker: Received command: "${cmd}"`);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
        console.log("Service Worker: Could not find active tab, aborting.");
        return;
    }
    console.log(`Service Worker: Operating on tab ID ${tab.id} (${tab.url})`);

    if (cmd === "grab-mp3") {
        console.log("Service Worker: Handling 'grab-mp3'.");
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error("Service Worker: WebSocket is not connected. Aborting 'grab-mp3'.");
            showToast("Relay offline", tab.id);
            return;
        }

        try {
            await pingContentScript(tab.id); // Ensure content script is ready
            console.log("Service Worker: Executing findMp3Links script in the active tab.");
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: findMp3Links,
            });
            
            if (results && results[0] && results[0].result && results[0].result.length > 0) {
                const urls = results[0].result;
                console.log(`Service Worker: Script found ${urls.length} MP3s.`);
                showToast(`Found ${urls.length} MP3(s). Processing...`, tab.id);

                // Get page context ONCE to use for all jobs from this command.
                const contextResponse = await chrome.tabs.sendMessage(tab.id, { action: "findAudio" });

                for (const url of urls) {
                    const job = { 
                        id: crypto.randomUUID(), 
                        url: url,
                        pageText: contextResponse.pageText,
                        itemCount: contextResponse.itemCount,
                        taskType: contextResponse.taskType // Pass the hint from the content script
                    };
                    jobTabMap[job.id] = tab.id;
                    ws.send(JSON.stringify(job));
                    console.log(`Service Worker: Sent job ${job.id} for URL ${url}.`);
                }
            } else {
                console.log("Service Worker: Script found no MP3 links.");
                showToast("No MP3 links found on this page.", tab.id);
            }
        } catch (error) {
            console.error(`Service Worker: Could not execute 'grab-mp3' script.`, error.message);
            showToast("Could not scan this page for MP3s.", tab.id);
        }
    } else if (cmd === "send-audio") {
        console.log("Service Worker: Handling 'send-audio'.");
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error("Service Worker: WebSocket is not connected. Aborting 'send-audio'.");
            showToast("Relay offline", tab.id);
            return;
        }

        const jobId = crypto.randomUUID();
        lastJobId = jobId;
        logStore[jobId] = []; // Initialize log array
        addLog(jobId, 'Service Worker', 'Command "send-audio" received. Starting job.');
        
        try {
            await pingContentScript(tab.id); // This now handles all injection logic
            const response = await chrome.tabs.sendMessage(tab.id, { action: "findAudio" });
            if (response?.url) {
                // The WebSocket payload now includes page context and task type.
                const job = { 
                    id: jobId, 
                    url: response.url,
                    pageText: response.pageText,
                    itemCount: response.itemCount,
                    taskType: response.taskType
                };
                jobTabMap[job.id] = tab.id; // Store the tab ID for this job
                console.log(`Service Worker: Received audio URL and context. Sending job ${job.id} to relay.`);
                ws.send(JSON.stringify(job));
                showToast("Audio and page context sent for transcription", tab.id);
            } else {
                console.log("Service Worker: Content script found no audio.");
                showToast(response?.error || "No audio found", tab.id);
            }
        } catch (e) {
            console.error("Service Worker: Error communicating with content script for 'send-audio'.", e);
            showToast("Could not communicate with the page.", tab.id);
        }
    } else if (cmd === "paste-next-answer") {
        handlePasteNext(tab.id);
    }
});

// New handler for pasting the next available answer.
async function handlePasteNext(tabId) {
    const jobId = lastJobId; // Assume pasting relates to the last job
    if (answerStore[tabId] && answerStore[tabId].answers.length > 0) {
        const { taskType, answers } = answerStore[tabId];
        const nextAnswer = answers.shift(); // Get and remove the next answer
        console.log(`Service Worker: Pasting next answer. Type: "${taskType}". Remaining: ${answers.length}.`);
        
        // The action is now more specific, telling the content script HOW to handle the answer.
        const action = (taskType === 'true-false') ? 'show-toast-answer' : 'paste-text';

        await chrome.tabs.sendMessage(tabId, {
            action,
            text: nextAnswer
        });

        const remaining = answers.length;
        if (remaining > 0) {
            showToast(`${remaining} answer(s) left.`, tabId);
        } else {
            showToast("All answers processed!", tabId);
            delete answerStore[tabId]; // Clean up
        }

    } else {
        console.log("Service Worker: Paste command received, but no answers available.");
        showToast("No answers available.", tabId);
    }
}

// --- Helper function to ensure content script is ready ---
async function pingContentScript(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: "ping" });
        if (response?.status === "pong") {
            console.log("Service Worker: Content script is active.");
            return true; // It's ready
        }
    } catch (e) {
        // This error means the content script is not injected yet.
        console.log("Service Worker: Content script not found. Injecting now.");
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js'],
        });
        console.log("Service Worker: Injection successful.");
    }
}

console.log("Service Worker event listeners registered.");

// --- Central Logging System ---
function addLog(jobId, source, message) {
    if (!jobId || !logStore[jobId]) {
        // console.warn(`Log attempt for unknown or uninitialized job ID: ${jobId}`);
        return;
    }
    const logEntry = {
        timestamp: Date.now(),
        source: source,
        message: message
    };
    logStore[jobId].push(logEntry);
    console.log(`[Log][${source}] ${message}`);
}

// --- Message Handling from other parts of the extension ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'log' && request.jobId) {
        addLog(request.jobId, 'Content Script', request.message);
    } else if (request.action === 'get-last-log') {
        if (lastJobId && logStore[lastJobId]) {
            sendResponse({ jobId: lastJobId, logs: logStore[lastJobId] });
        } else {
            sendResponse({ jobId: null, logs: [] });
        }
    }
    // Keep other message handlers if they exist...
    return true; // Required for async sendResponse
});
