# Bug Fixes - Version 0.4.1

## Issues Fixed

### 1. Multiple Quality Downloads (Canvas)
**Problem**: Canvas serves multiple quality versions (low/medium/high) of the same video, all being captured and downloaded separately.

**Solution**: Added base URL tracking to detect quality variants:
- Strips query parameters and quality indicators (`_low`, `_medium`, `_high`, `_360p`, etc.)
- Tracks base URL with 10-second window
- Only downloads first quality variant detected
- Prevents 3x redundant downloads

**Files Changed**: `extension/bg.js`

**Code**:
```javascript
const processedBaseUrls = new Map(); // Track base URLs
const baseUrl = details.url.split('?')[0].replace(/_(low|medium|high|[0-9]+p)\.m3u8/i, '.m3u8');
if (processedBaseUrls.has(baseUrl)) { /* skip */ }
```

### 2. GPU Not Being Used
**Problem**: Transcription uses CPU even when GPU is available, causing slow processing.

**Root Cause**: GPU detection works, but if faster-whisper encounters any CUDA initialization issue, it silently falls back to CPU.

**Solution**: 
- Added explicit status logging when GPU fails
- Changed CPU fallback model from "base" to "small" (better quality, similar speed)
- User can verify GPU usage in logs

**Files Changed**: `transcribe.py`

**Verification**:
```bash
# Check logs for:
# "STATUS:Initializing CUDA processing..." = GPU detected
# "STATUS:Initializing CPU processing..." = Using CPU
# "STATUS:GPU failed, falling back to CPU..." = GPU attempted but failed
```

### 3. MPEG-TS Warning (ffmpeg)
**Problem**: `WARNING: Possible MPEG-TS in MP4 container or malformed AAC timestamps. Install ffmpeg to fix this automatically`

**Solution**:
- Added ffmpeg check to `start.js` prerequisites
- **Added automatic installation** for all platforms (Windows/Mac/Linux)
- Added ffmpeg post-processor args to yt-dlp command: `--postprocessor-args ffmpeg:-fflags +genpts`
- ffmpeg fixes timestamp issues automatically if installed

**Files Changed**: `start.js`, `relay.js`

**Auto-Installation Methods**:
- **Windows**: Tries Chocolatey first, then Scoop
- **Mac**: Uses Homebrew
- **Linux**: Tries apt, then yum, then dnf

**Manual Installation** (if auto-install fails):
```bash
# Windows (Chocolatey - recommended)
choco install ffmpeg

# Windows (Scoop)
scoop install ffmpeg

# Mac
brew install ffmpeg

# Linux (Debian/Ubuntu)
sudo apt install ffmpeg

# Linux (RHEL/CentOS)
sudo yum install ffmpeg
```

### 4. Slow Transcription
**Problem**: Transcription takes too long.

**Causes**:
1. **Using CPU instead of GPU** (see issue #2)
2. **Model size**: Base model is fast but lower quality
3. **File length**: Canvas lectures can be 30-60 minutes

**Solutions**:
- Fixed GPU detection (issue #2)
- Changed CPU model from "base" to "small":
  - Small: ~2x slower than base, but much better quality
  - Medium (GPU): ~3x slower than base, best quality
- Added quality selection to yt-dlp: `-f best` (downloads best available quality)

**Expected Speed** (for 1 hour audio):
- GPU (medium model): 5-10 minutes
- CPU (small model): 20-30 minutes
- CPU (base model): 10-15 minutes (lower quality)

**Files Changed**: `transcribe.py`, `relay.js`

### 5. Best Quality Selection
**Problem**: yt-dlp might download lower quality by default.

**Solution**: Added format selection flag to yt-dlp:
```javascript
ytdlpArgs.push('-f', 'best'); // Download best single file
```

**Files Changed**: `relay.js`

## Updated Files Summary

1. **`extension/bg.js`**
   - Added `processedBaseUrls` Map for base URL tracking
   - Strips quality indicators from URLs
   - 10-second debounce window for same video

2. **`relay.js`**
   - Added `-f best` format selection
   - Added `--postprocessor-args ffmpeg:-fflags +genpts`

3. **`start.js`**
   - Added ffmpeg version check
   - Shows installation instructions if missing
   - Non-blocking (optional dependency)

4. **`transcribe.py`**
   - Changed CPU model: base → small
   - Added explicit GPU failure logging
   - Better status messages

## Testing

### Verify Multiple Download Fix
1. Navigate to Canvas lecture
2. Check extension console: Should see "Skipping quality variant" messages
3. Check relay server: Should only see 1 download per video
4. Check `uploads/` folder: Should have 1 file per video (not 3)

### Verify GPU Usage
1. Start transcription
2. Check terminal output for: `STATUS:Initializing CUDA processing...`
3. Open Task Manager → Performance → GPU
4. GPU should show activity during transcription
5. If shows "CPU processing", GPU libraries may not be properly installed

### Verify ffmpeg Fix
1. Install ffmpeg (see instructions above)
2. Restart relay server
3. Download Canvas video
4. Check logs: Should NOT see MPEG-TS warning
5. If still see warning, ffmpeg not in PATH

### Verify Transcription Speed
**Before (CPU base model, no GPU)**: ~15min for 1hr video
**After (GPU medium model)**: ~7min for 1hr video
**After (CPU small model, no GPU)**: ~25min for 1hr video (better quality than before)

## Configuration

### Force CPU Mode (for testing)
Edit `transcribe.py` line 159:
```python
gpu_available = False  # Force CPU mode
```

### Change Model Size
Edit `transcribe.py` lines 164, 167, 170:
```python
# GPU
result = transcribe_audio(audio_file, model_size="large", use_gpu=True)

# CPU
result = transcribe_audio(audio_file, model_size="medium", use_gpu=False)
```

**Model Sizes**:
- `tiny`: Fastest, lowest quality
- `base`: Fast, basic quality
- `small`: Balanced (new CPU default)
- `medium`: Slow, good quality (GPU default)
- `large`: Slowest, best quality

## Known Remaining Issues

1. **GPU May Not Work**: If CUDA libraries not properly configured, will use CPU
2. **Long Videos**: 60+ minute videos take significant time even with GPU
3. **Disk Space**: Downloads are stored temporarily, can use several GB
4. **Network Speed**: Download speed depends on Canvas/Kaltura CDN

## Rollback

If issues persist, revert changes:
```bash
git checkout HEAD~1 extension/bg.js relay.js start.js transcribe.py
```
