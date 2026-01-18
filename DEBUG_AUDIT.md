# Debug Audit Report - MP3Grabber
**Date:** November 2, 2025
**Auditor:** AI Assistant
**Scope:** Transcription, Server, Extension

---

## EXECUTIVE SUMMARY

This audit identifies functional issues in the MP3Grabber codebase across three main components:
1. Transcription System (transcribe.py)
2. Server & Relay (relay.js, start.js)
3. Browser Extension (bg.js, content.js, manifest.json)

**Critical Issues Found:** 8
**High Priority Issues:** 12
**Medium Priority Issues:** 7
**Low Priority Issues:** 5

---

## 1. TRANSCRIPTION SYSTEM (transcribe.py)

### CRITICAL ISSUES

#### 1.1 Missing Whisper Binary Validation
**File:** `transcribe.py`
**Lines:** 8-11
**Severity:** CRITICAL
**Issue:** The code checks if whisper binary exists but doesn't validate if it's executable or the correct version.
```python
if not os.path.exists(whisper_path):
    print(f"Error: Whisper binary not found at {whisper_path}")
    sys.exit(1)
```
**Impact:** May fail silently if binary is corrupted or wrong architecture.
**Recommendation:** Add executable permission check and version validation.

#### 1.2 Race Condition in File Writing
**File:** `transcribe.py`
**Lines:** 42-45
**Severity:** CRITICAL
**Issue:** No file locking mechanism when writing transcription results.
```python
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(result.stdout)
```
**Impact:** Concurrent transcriptions may corrupt output files.
**Recommendation:** Implement file locking or atomic writes.

### HIGH PRIORITY ISSUES

#### 1.3 Insufficient Error Context
**File:** `transcribe.py`
**Lines:** 37-39
**Severity:** HIGH
**Issue:** Error messages don't include stderr output for debugging.
```python
except subprocess.CalledProcessError as e:
    print(f"Error during transcription: {e}")
    sys.exit(1)
```
**Impact:** Difficult to diagnose transcription failures.
**Recommendation:** Include stderr in error output: `print(f"Error: {e}\nStderr: {e.stderr}")`

#### 1.4 No Input File Validation
**File:** `transcribe.py`
**Lines:** 18-21
**Severity:** HIGH
**Issue:** No validation of audio file format or size before processing.
```python
if not os.path.exists(audio_path):
    print(f"Error: Audio file not found: {audio_path}")
    sys.exit(1)
```
**Impact:** Whisper may crash on invalid audio formats, wasting resources.
**Recommendation:** Add file format validation (check magic bytes) and reasonable size limits.

#### 1.5 Hardcoded Model Path
**File:** `transcribe.py`
**Line:** 28
**Severity:** HIGH
**Issue:** Model path is hardcoded and may not exist.
```python
model_path = os.path.join(whisper_dir, 'models', 'ggml-base.en.bin')
```
**Impact:** Transcription fails if model doesn't exist or user wants different model.
**Recommendation:** Make model configurable via command line or config file.

#### 1.6 No Timeout Protection
**File:** `transcribe.py`
**Lines:** 32-36
**Severity:** HIGH
**Issue:** Subprocess has no timeout, can hang indefinitely on problematic files.
```python
result = subprocess.run(
    command,
    capture_output=True,
    text=True,
    check=True
)
```
**Impact:** Server resources locked by hung processes.
**Recommendation:** Add timeout parameter: `timeout=300` (5 minutes).

### MEDIUM PRIORITY ISSUES

#### 1.7 No Progress Feedback
**File:** `transcribe.py`
**Severity:** MEDIUM
**Issue:** No progress updates for long transcriptions.
**Impact:** User has no feedback during processing.
**Recommendation:** Parse whisper output for progress indicators.

---

## 2. SERVER SYSTEM (relay.js, start.js)

### CRITICAL ISSUES

#### 2.1 Unhandled Promise Rejections
**File:** `relay.js`
**Lines:** 68-75
**Severity:** CRITICAL
**Issue:** Python spawn errors aren't properly caught.
```javascript
pythonProcess.on('error', (error) => {
    console.error('Python process error:', error);
    ws.send(JSON.stringify({
        type: 'error',
        message: 'Transcription process failed to start'
    }));
});
```
**Impact:** Server may crash on Python spawn failures.
**Recommendation:** Add try-catch around spawn and proper error propagation.

#### 2.2 Memory Leak in File Uploads
**File:** `relay.js`
**Lines:** 28-42
**Severity:** CRITICAL
**Issue:** Uploaded files accumulate without cleanup mechanism.
```javascript
const uploadPath = path.join(__dirname, 'uploads', `${uuidv4()}.m4a`);
await fs.writeFile(uploadPath, buffer);
```
**Impact:** Disk space exhaustion over time.
**Recommendation:** Implement automatic cleanup of old uploads (e.g., after 24 hours).

#### 2.3 WebSocket Connection Not Validated
**File:** `relay.js`
**Lines:** 9-13
**Severity:** CRITICAL
**Issue:** No validation of WebSocket origin or authentication.
```javascript
wss.on('connection', (ws) => {
    console.log('Client connected');
```
**Impact:** Any origin can connect and trigger transcriptions, potential DoS.
**Recommendation:** Add origin validation and rate limiting.

### HIGH PRIORITY ISSUES

#### 2.4 Race Condition in Process Management
**File:** `relay.js`
**Lines:** 68-95
**Severity:** HIGH
**Issue:** No tracking of active Python processes per connection.
```javascript
const pythonProcess = spawn('python', [
    path.join(__dirname, 'transcribe.py'),
    uploadPath
]);
```
**Impact:** Multiple simultaneous transcriptions may interfere.
**Recommendation:** Track processes per WebSocket connection, limit concurrent jobs.

#### 2.5 Insufficient Error Recovery
**File:** `relay.js`
**Lines:** 76-82
**Severity:** HIGH
**Issue:** Python process errors don't clean up uploaded files.
```javascript
pythonProcess.on('error', (error) => {
    console.error('Python process error:', error);
    ws.send(JSON.stringify({
        type: 'error',
        message: 'Transcription process failed to start'
    }));
});
```
**Impact:** Failed transcriptions leave orphaned files.
**Recommendation:** Add cleanup in error handlers.

#### 2.6 Missing CORS Configuration
**File:** `relay.js`
**Lines:** 5-7
**Severity:** HIGH
**Issue:** CORS headers not set, may cause browser errors.
```javascript
const app = express();
app.use(express.json());
```
**Impact:** Extension may fail to communicate from certain contexts.
**Recommendation:** Add proper CORS middleware.

#### 2.7 Port Conflict Not Handled
**File:** `relay.js`
**Line:** 110
**Severity:** HIGH
**Issue:** No error handling if port 3000 is already in use.
```javascript
server.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
```
**Impact:** Silent failure or crash on startup.
**Recommendation:** Add error handler and fallback ports.

#### 2.8 Buffer Size Limits Not Set
**File:** `relay.js`
**Lines:** 28-32
**Severity:** HIGH
**Issue:** No limit on upload size, vulnerable to memory exhaustion.
```javascript
const buffer = Buffer.from(audioData, 'base64');
const uploadPath = path.join(__dirname, 'uploads', `${uuidv4()}.m4a`);
```
**Impact:** Large uploads can crash server.
**Recommendation:** Add express.json({limit: '50mb'}) and validate buffer size.

### MEDIUM PRIORITY ISSUES

#### 2.9 Hardcoded Python Command
**File:** `relay.js`
**Line:** 68
**Severity:** MEDIUM
**Issue:** Assumes 'python' is in PATH and correct version.
```javascript
const pythonProcess = spawn('python', [
```
**Impact:** May use wrong Python version or fail on systems without Python in PATH.
**Recommendation:** Use configurable Python path from config.json.

#### 2.10 No Health Check Endpoint
**File:** `relay.js`
**Severity:** MEDIUM
**Issue:** No endpoint to verify server is operational.
**Impact:** Difficult to monitor server status.
**Recommendation:** Add GET /health endpoint.

#### 2.11 WebSocket Reconnection Not Handled
**File:** `relay.js`
**Lines:** 14-17
**Severity:** MEDIUM
**Issue:** No automatic reconnection logic for dropped connections.
```javascript
ws.on('close', () => {
    console.log('Client disconnected');
});
```
**Impact:** Extension must manually reconnect.
**Recommendation:** Implement heartbeat/ping-pong mechanism.

---

## 3. BROWSER EXTENSION (bg.js, content.js, manifest.json)

### CRITICAL ISSUES

#### 3.1 Recorder State Not Tracked
**File:** `bg.js`
**Lines:** 31-71
**Severity:** CRITICAL
**Issue:** No global state to prevent multiple simultaneous recordings.
```javascript
if (request.action === "startRecording") {
    startRecording(sendResponse);
}
```
**Impact:** Starting recording twice crashes the extension.
**Recommendation:** Add isRecording flag and check before starting.

#### 3.2 MediaRecorder Error Not Handled
**File:** `bg.js`
**Lines:** 34-42
**Severity:** CRITICAL
**Issue:** No error handler on MediaRecorder.
```javascript
recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
recorder.ondataavailable = (event) => {
    audioChunks.push(event.data);
};
```
**Impact:** Silent failure if recording fails.
**Recommendation:** Add recorder.onerror handler.

#### 3.3 Memory Leak in Audio Chunks
**File:** `bg.js`
**Lines:** 32-45
**Severity:** CRITICAL
**Issue:** audioChunks array never cleared on recording failure.
```javascript
let audioChunks = [];
```
**Impact:** Memory accumulates with failed recordings.
**Recommendation:** Clear audioChunks in error handlers and cleanup.

### HIGH PRIORITY ISSUES

#### 3.4 WebSocket Connection Not Reused
**File:** `bg.js`
**Lines:** 62-71
**Severity:** HIGH
**Issue:** New WebSocket created for each transcription.
```javascript
const ws = new WebSocket('ws://localhost:3000');
```
**Impact:** Connection overhead and potential rate limiting issues.
**Recommendation:** Maintain persistent WebSocket connection.

#### 3.5 No Timeout on WebSocket Messages
**File:** `bg.js`
**Lines:** 73-85
**Severity:** HIGH
**Issue:** WebSocket listener never times out waiting for response.
```javascript
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
```
**Impact:** Extension hangs if server doesn't respond.
**Recommendation:** Add setTimeout to close connection after 5 minutes.

#### 3.6 Microphone Permission Not Checked
**File:** `bg.js`
**Lines:** 34-36
**Severity:** HIGH
**Issue:** Doesn't verify microphone permission before requesting stream.
```javascript
navigator.mediaDevices.getUserMedia({ audio: true })
```
**Impact:** Poor error messages when permission denied.
**Recommendation:** Check permissions first, provide clear user feedback.

#### 3.7 Blob Conversion May Fail
**File:** `bg.js`
**Lines:** 46-54
**Severity:** HIGH
**Issue:** FileReader has no error handler.
```javascript
const reader = new FileReader();
reader.onloadend = () => {
    const base64Audio = reader.result.split(',')[1];
```
**Impact:** Silent failure on blob read errors.
**Recommendation:** Add reader.onerror handler.

#### 3.8 Content Script Injection Timing
**File:** `content.js`
**Lines:** 1-45
**Severity:** HIGH
**Issue:** Script may run before page fully loads.
```javascript
const injectRecorder = () => {
    const existingButton = document.getElementById('voice-recorder-button');
```
**Impact:** Button injection may fail on some pages.
**Recommendation:** Use MutationObserver or document.readyState check.

### MEDIUM PRIORITY ISSUES

#### 3.9 Hardcoded Server URL
**File:** `bg.js`
**Line:** 62
**Severity:** MEDIUM
**Issue:** WebSocket URL hardcoded to localhost:3000.
```javascript
const ws = new WebSocket('ws://localhost:3000');
```
**Impact:** Cannot change server without code modification.
**Recommendation:** Make server URL configurable via extension options.

#### 3.10 No Recording Duration Limit
**File:** `bg.js`
**Severity:** MEDIUM
**Issue:** Recording can run indefinitely.
**Impact:** May create enormous files, crash browser.
**Recommendation:** Add maximum recording duration (e.g., 10 minutes).

#### 3.11 Manifest Permissions Too Broad
**File:** `manifest.json`
**Lines:** 12-13
**Severity:** MEDIUM
**Issue:** activeTab and scripting permissions for all URLs.
```json
"permissions": ["activeTab", "scripting"],
"host_permissions": ["<all_urls>"]
```
**Impact:** Excessive permissions reduce user trust.
**Recommendation:** Request minimum necessary permissions.

### LOW PRIORITY ISSUES

#### 3.12 No Visual Feedback During Recording
**File:** `content.js`
**Lines:** 27-32
**Severity:** LOW
**Issue:** Button text changes but no visual indication of recording state.
**Impact:** User may not realize recording is active.
**Recommendation:** Add pulsing animation or icon change.

#### 3.13 Button Position Not Configurable
**File:** `content.js`
**Lines:** 8-16
**Severity:** LOW
**Issue:** Button always appears in fixed position.
**Impact:** May overlap page content on some sites.
**Recommendation:** Make position configurable or use collision detection.

---

## 4. CROSS-CUTTING CONCERNS

### HIGH PRIORITY ISSUES

#### 4.1 No Logging Framework
**Severity:** HIGH
**Issue:** All components use console.log with no log levels or persistence.
**Impact:** Difficult to debug production issues.
**Recommendation:** Implement structured logging with levels (debug, info, warn, error).

#### 4.2 No Configuration Validation
**File:** `config.json`
**Severity:** HIGH
**Issue:** Config file exists but never validated on startup.
**Impact:** Invalid config causes cryptic runtime errors.
**Recommendation:** Validate config on startup with JSON schema.

### MEDIUM PRIORITY ISSUES

#### 4.3 No Graceful Shutdown
**Severity:** MEDIUM
**Issue:** None of the components handle SIGTERM/SIGINT properly.
**Impact:** Unclean shutdown may corrupt files or leave resources locked.
**Recommendation:** Add signal handlers to clean up resources.

#### 4.4 Inconsistent Error Messages
**Severity:** MEDIUM
**Issue:** Error messages vary in format across components.
**Impact:** Difficult to parse and monitor errors programmatically.
**Recommendation:** Standardize error message format (JSON or structured text).

### LOW PRIORITY ISSUES

#### 4.5 No Version Information
**Severity:** LOW
**Issue:** No way to determine version of running components.
**Impact:** Difficult to diagnose version-specific issues.
**Recommendation:** Add version endpoint/flag to each component.

---

## 5. RECOMMENDED PRIORITY FIXES

### Immediate (This Week)
1. Fix unhandled promise rejections in relay.js (2.1)
2. Add recorder state tracking in bg.js (3.1)
3. Implement file cleanup for uploads (2.2)
4. Add MediaRecorder error handler (3.2)
5. Validate WebSocket connections (2.3)

### Short Term (Next 2 Weeks)
1. Add timeout protection to transcription (1.6)
2. Implement file locking in transcribe.py (1.2)
3. Fix race conditions in process management (2.4)
4. Add WebSocket timeout handling (3.5)
5. Implement proper error recovery with cleanup (2.5)

### Medium Term (Next Month)
1. Add comprehensive logging framework (4.1)
2. Implement configuration validation (4.2)
3. Add health check endpoint (2.10)
4. Make server URL configurable (3.9)
5. Improve error messages consistency (4.4)

### Long Term (Next Quarter)
1. Add progress feedback for transcriptions (1.7)
2. Implement graceful shutdown (4.3)
3. Optimize WebSocket connection reuse (3.4)
4. Add version information (4.5)
5. Refine permissions model (3.11)

---

## 6. TESTING RECOMMENDATIONS

### Unit Tests Needed
- `transcribe.py`: File validation, error handling, output formatting
- `relay.js`: File upload handling, WebSocket message parsing
- `bg.js`: Recording state management, blob conversion

### Integration Tests Needed
- End-to-end recording → transcription flow
- WebSocket reconnection scenarios
- Concurrent transcription handling
- File cleanup after errors

### Load Tests Needed
- Multiple simultaneous recordings
- Large file uploads
- Sustained WebSocket connections

---

## APPENDIX A: Tools & Commands for Verification

### Check for Hanging Processes
```powershell
Get-Process | Where-Object {$_.ProcessName -like "*python*" -or $_.ProcessName -like "*node*"}
```

### Monitor Upload Directory Growth
```powershell
Get-ChildItem uploads | Measure-Object -Property Length -Sum
```

### Test WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:3000');
ws.onopen = () => console.log('Connected');
ws.onerror = (e) => console.error('Error:', e);
```

### Verify Python Process Spawning
```powershell
python transcribe.py "test.m4a"
```

---

**End of Debug Audit Report**

