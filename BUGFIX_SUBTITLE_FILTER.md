# Bug Fix: "tuple index out of range" Error

## Issue Summary
The application was attempting to transcribe WebVTT subtitle/caption files as if they were audio/video files, causing the `faster-whisper` library to fail with the error: `tuple index out of range`.

## Root Cause
When processing Kaltura video pages, the browser extension was detecting ALL network requests including:
- Actual video stream URLs (.m3u8)
- WebVTT caption/subtitle files
- Multiple quality variants of the same video

The relay server would then attempt to download and transcribe ALL of these URLs, including subtitle files which are not valid audio inputs for Whisper.

## Changes Made

### 1. URL Filtering in `relay.js` (Lines 603-626)
**Added subtitle/caption URL detection:**
```javascript
// Filter out subtitle/caption URLs (WebVTT, SRT, etc.)
const isSubtitleUrl = url.includes('caption') || 
                     url.includes('subtitle') || 
                     url.includes('serveWebVTT') || 
                     url.includes('.vtt') || 
                     url.includes('.srt') ||
                     url.includes('captionasset') ||
                     url.includes('caption_captionasset');
```

**Action:** URLs matching these patterns are now skipped before download, and a `transcription_skipped` message is sent to connected clients.

### 2. File Size Validation in `relay.js` (Lines 318-322)
**Added file size check:**
```javascript
// Validate file size before attempting transcription
const stats = statSync(file);
if (stats.size < 1000) {
    throw new Error(`File too small to be valid audio/video (${stats.size} bytes). This may be a subtitle or caption file.`);
}
```

**Action:** Files smaller than 1KB are rejected as they cannot be valid audio/video files.

### 3. Enhanced Error Handling in `transcribe.py` (Lines 46-53)
**Added specific error catching:**
```python
try:
    segments, info = model.transcribe(audio_file, beam_size=5)
except (ValueError, IndexError, TypeError) as transcribe_error:
    error_msg = str(transcribe_error)
    if "tuple index out of range" in error_msg or "list index out of range" in error_msg:
        raise ValueError(f"Invalid audio file format. This may be a subtitle/caption file or corrupted media. Original error: {error_msg}")
    raise
```

**Action:** Provides clearer error messages when invalid files are passed to the transcription model.

### 4. UI Updates in `viewer.html`
**Added handler for skipped transcriptions:**
- New CSS class `.status-skipped` (gray color)
- New message type handler for `transcription_skipped`
- Displays reason for skipping (e.g., "Subtitle/caption file detected")

## Testing Recommendations

1. **Test with Kaltura videos** - Verify that only actual video streams are transcribed
2. **Check viewer.html** - Confirm that skipped subtitle files show "Skipped" status in gray
3. **Test with multiple quality variants** - Ensure only one quality version is processed
4. **Verify error messages** - Check that meaningful error messages are displayed for invalid files

## Files Modified
- `relay.js` - Added URL filtering and file size validation
- `transcribe.py` - Enhanced error handling for invalid audio files
- `viewer.html` - Added UI support for skipped transcriptions

## Impact
- **Reduces unnecessary processing** - Subtitle files are filtered out immediately
- **Clearer error messages** - Users understand why certain files failed or were skipped
- **Better performance** - Prevents wasted CPU/GPU cycles on invalid files
- **Improved user experience** - UI shows skipped items rather than failed transcriptions
