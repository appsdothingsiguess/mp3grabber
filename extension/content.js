function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.textContent = message;
    Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '1em',
        backgroundColor: isError ? '#ff4444' : '#333',
        color: 'white',
        borderRadius: '5px',
        zIndex: '9999',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
    });
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// This is a content script, which will be injected into web pages.
// It is currently a placeholder. 

function gatherPageContext() {
    console.log("Content Script: Starting to gather page context.");

    // 1. Find the main content area of the page.
    const mainContent = document.querySelector('main, [role="main"], #main, #content, .main, .content');
    const scope = mainContent || document.body; // Fallback to the whole body

    // 2. Determine the task type by analyzing the page structure.
    let taskType = 'default'; // Default task type
    const textInputs = scope.querySelectorAll('input[type="text"], textarea');
    const radioInputs = scope.querySelectorAll('input[type="radio"]');

    if (textInputs.length > 1 && Array.from(textInputs).every(el => el.value === '')) {
        // Multiple empty text boxes suggest a dictation/fill-in-the-blank task.
        taskType = 'dictation';
    } else if (radioInputs.length > 1) {
        // Radio buttons suggest a multiple choice or true/false task.
        // A more specific check could look for T/F labels if needed.
        taskType = 'true-false';
    }
    console.log(`Content Script: Detected task type: "${taskType}"`);

    // 3. Gather all visible text from within that area.
    let collectedText = scope.innerText || '';

    // 4. Trim the text to a maximum of 6kB to stay within reasonable limits.
    if (new TextEncoder().encode(collectedText).length > 6000) {
        const buffer = new TextEncoder().encode(collectedText);
        collectedText = new TextDecoder().decode(buffer.slice(0, 6000));
    }
    console.log(`Content Script: Gathered ${collectedText.length} characters of text.`);

    // 5. Count interactive or list-like items.
    const itemSelectors = [
        'input[type="text"]', 'textarea',
        'input[type="radio"]', 'input[type="checkbox"]',
        'li', 'tr'
    ];
    const itemCount = scope.querySelectorAll(itemSelectors.join(', ')).length;
    console.log(`Content Script: Found ${itemCount} items. Detected task type: "${taskType}".`);

    return { pageText: collectedText.trim(), itemCount, taskType };
}

function findFirstAudioUrl() {
    // 1. Check for <audio src="...">
    const audioElement = document.querySelector('audio[src]');
    if (audioElement?.src) return audioElement.src;

    // 2. Check for <audio><source src="..."></audio>
    const sourceElement = document.querySelector('audio source[src]');
    if (sourceElement?.src) return sourceElement.src;

    // 3. Check for anchor tags with audio file extensions
    const audioExtensions = ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];
    const links = Array.from(document.querySelectorAll('a'));
    for (const link of links) {
        try {
            const url = new URL(link.href);
            if (audioExtensions.some(ext => url.pathname.toLowerCase().endsWith(ext))) {
                return link.href;
            }
        } catch (e) {
            // Ignore invalid URLs
        }
    }

    return null;
}

function pasteIntoActiveElement(text) {
    const activeEl = document.activeElement;
    console.log(`Content Script: Pasting text into active element: ${activeEl?.tagName || 'none'}`);
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        const oldValue = activeEl.value;
        activeEl.value = text;
        const event = new Event('input', { bubbles: true });
        event.simulated = true;
        const tracker = activeEl._valueTracker;
        if (tracker) {
            tracker.setValue(oldValue);
        }
        activeEl.dispatchEvent(event);
    } else {
        console.warn("Content Script: Paste failed. No suitable input field is focused.");
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action } = request;
    
    // Actions that expect an asynchronous response
    if (action === "findAudio") {
        console.log("Content Script: Received 'findAudio' request.");
        try {
            const audioUrl = findFirstAudioUrl();
            if (audioUrl) {
                const { pageText, itemCount, taskType } = gatherPageContext();
                sendResponse({ url: audioUrl, pageText, itemCount, taskType });
            } else {
                sendResponse({ error: "No audio found on page" });
            }
        } catch (e) {
            sendResponse({ error: `An error occurred in content script: ${e.message}` });
        }
        return true; // Essential to signal an async response.
    }

    if (action === 'paste-text') {
        pasteIntoActiveElement(request.text);
        sendResponse({ status: "done" });
        return true; // Essential to signal an async response.
    }

    if (action === 'show-toast-answer') {
        showToast(`Answer: ${request.text}`);
        sendResponse({ status: "done" });
        return true; // Essential to signal an async response.
    }
    
    // Synchronous actions (or fire-and-forget)
    if (action === "showToast") {
        showToast(request.message, request.isError);
        // No 'return true' needed as the sender does not wait for a response.
    }

    // Ping is a special case of a synchronous response
    if (action === "ping") {
        sendResponse({ status: "pong" });
    }
}); 