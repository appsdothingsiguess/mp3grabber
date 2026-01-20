document.getElementById('queueAll').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.className = '';
  statusDiv.textContent = 'Queueing detected streams...';
  statusDiv.style.display = 'block';
  
  try {
    // Send message to background to flush all pending streams
    chrome.runtime.sendMessage({ 
      action: 'flushAllStreams'
    }, (response) => {
      if (chrome.runtime.lastError) {
        statusDiv.className = 'error';
        statusDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
        return;
      }
      
      if (response && response.success) {
        statusDiv.className = 'success';
        const count = response.count || 0;
        if (count === 0) {
          statusDiv.textContent = '⚠️ No streams detected. Play a video first.';
        } else {
          statusDiv.textContent = `✓ Queued ${count} stream(s)`;
          setTimeout(() => window.close(), 2000);
        }
      } else {
        statusDiv.className = 'error';
        statusDiv.textContent = response?.error || 'Failed to queue streams';
      }
    });
  } catch (error) {
    statusDiv.className = 'error';
    statusDiv.textContent = 'Error: ' + error.message;
  }
});

document.getElementById('manualTrigger').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'manualTrigger' }, () => {
    window.close();
  });
});
