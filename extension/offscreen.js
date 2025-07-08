// This script will handle clipboard operations for the offscreen document.
chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(message, sender, sendResponse) {
    if (message.target !== 'offscreen') {
        return true; // Ignore messages not meant for this context
    }

    switch (message.action) {
        case 'process-for-download':
            console.log('offscreen.js: Received "process-for-download" command.');
            // This function will perform both actions and send back the URL.
            processAndCreateUrl(message.text, sendResponse);
            break;
        
        case 'revoke-url':
            console.log('offscreen.js: Received "revoke-url" command for', message.url);
            URL.revokeObjectURL(message.url);
            break;
    }

    // Return true to indicate that we will be responding asynchronously.
    return true;
}

// Handles both copying and creating the Blob URL.
function processAndCreateUrl(text, sendResponse) {
    // 1. Handle the clipboard copy.
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!success) {
        console.error("offscreen.js: Failed to copy text using execCommand.");
        sendResponse({ status: 'error', message: "Failed to copy text." });
        return;
    }
    console.log('offscreen.js: Text successfully copied to clipboard.');

    // 2. Create the Blob and its URL.
    try {
        const blob = new Blob([text], { type: 'text/plain' });
        const blobUrl = URL.createObjectURL(blob);
        console.log('offscreen.js: Successfully created Blob URL:', blobUrl);
        sendResponse({ status: 'success', blobUrl: blobUrl });
    } catch (err) {
        console.error("offscreen.js: Error creating Blob URL:", err);
        sendResponse({ status: 'error', message: err.message });
    }
} 