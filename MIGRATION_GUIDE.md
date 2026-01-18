# Network Sniffing Architecture - Migration Guide

## What Changed

The MP3 Grabber extension has been completely refactored from **DOM scraping** to **network packet sniffing**. This architectural change enables support for modern streaming protocols and authenticated content.

### Architecture Comparison

| Aspect | Old (DOM Scraping) | New (Network Sniffing) |
|--------|-------------------|------------------------|
| **Detection Method** | `document.querySelectorAll` | `chrome.webRequest.onBeforeRequest` |
| **Supported Content** | Direct file links only | HLS/DASH streams + direct files |
| **Authentication** | ❌ Cannot handle auth | ✅ Captures session cookies |
| **Downloader** | Native `https.get` | `yt-dlp` with cookie injection |
| **Stream Support** | ❌ Fails on `.m3u8`, `.mpd` | ✅ Native support |

## New Capabilities

### 1. HLS/DASH Stream Detection
The extension now passively monitors all network requests and automatically detects streaming manifests:
- **HLS**: `.m3u8` manifests
- **DASH**: `.mpd` manifests

### 2. Authenticated Content Support
Works with platforms that require session authentication:
- Canvas LMS
- Kaltura
- Panopto
- AWS CloudFront signed URLs
- Any platform using session cookies

### 3. yt-dlp Integration
The relay server now uses `yt-dlp` (industry-standard downloader) instead of basic `https.get`:
- Handles segmented streams (HLS/DASH)
- Supports cookie-based authentication
- Manages complex URL signatures
- Automatic quality selection

## File Changes Summary

### Extension Files

#### `extension/manifest.json`
- **Permissions**: Changed from `scripting`, `activeTab` to `webRequest`, `cookies`
- **Host Permissions**: Changed from YouTube-only to `<all_urls>` (all domains)
- **Content Scripts**: Removed entirely (no longer injecting into pages)
- **Version**: Bumped to `0.4`

#### `extension/bg.js`
- **Removed**: All DOM scraping functions (`findAudioLinks`, `findYouTubeAudioLinks`)
- **Removed**: `chrome.scripting.executeScript` calls
- **Added**: `chrome.webRequest.onBeforeRequest` listener for passive interception
- **Added**: Cookie extraction via `chrome.cookies.getAll()`
- **Added**: Debounce mechanism to prevent duplicate stream captures
- **Kept**: WebSocket connection logic (unchanged)
- **Repurposed**: Keyboard shortcut now triggers connection verification

#### `extension/content.js`
- **Status**: No longer used (can be safely removed)
- The extension now operates entirely from the background script

### Server Files

#### `relay.js`
- **Added**: `readdirSync` to imports for filename scanning
- **Added**: `DOWNLOADS_DIR` constant for temporary files
- **Added**: `formatCookie()` - Converts Chrome cookies to Netscape format
- **Added**: `writeNetscapeCookieFile()` - Writes cookie file for yt-dlp
- **Added**: `stream_found` message handler with full yt-dlp integration
- **Added**: `ping`/`pong` message handler for connection verification
- **Changed**: Filename detection now scans for `jobId`-prefixed files
- **Kept**: Existing `blob` and `url` handlers for backward compatibility

#### `start.js`
- **Added**: `yt-dlp` version check in `checkPrerequisites()`
- **Added**: Automatic `pip install yt-dlp` if not found
- **Added**: Error handling for yt-dlp installation failures
- **Changed**: yt-dlp is now a **required** dependency

## Usage Changes

### Before (DOM Scraping)
1. Navigate to a page with audio links
2. Press `Ctrl+Shift+M`
3. Extension injects script and scrapes DOM
4. Direct file URLs sent to relay server

### After (Network Sniffing)
1. Start relay server: `npm run setup` → Choose option 2
2. Load extension in Chrome
3. Navigate to any page with streaming media
4. **Automatic detection** - no keyboard shortcut needed
5. Stream URLs + cookies automatically sent to relay server
6. yt-dlp downloads and transcribes

### Manual Trigger (Optional)
The `Ctrl+Shift+M` keyboard shortcut still exists but now:
- Verifies WebSocket connection
- Sends ping to relay server
- Useful for testing connectivity

## New Dependencies

### Required
- **yt-dlp**: Installed automatically via `pip install yt-dlp`
  - Used for downloading HLS/DASH streams
  - Handles cookie-based authentication
  - Manages complex stream protocols

### Existing (Unchanged)
- Node.js dependencies: `express`, `ws`, `uuid`
- Python dependencies: `faster-whisper`, CUDA libraries (if GPU)

## Testing

### 1. Extension Loading
```bash
# Chrome → Extensions → Load Unpacked
# Point to: mp3grabber/extension/
# Verify: No errors in console
```

### 2. Connection Test
```bash
# Start relay server
npm run setup
# Choose option 2

# In Chrome, press Ctrl+Shift+M
# Check relay server console for: "🏓 Ping received from extension"
```

### 3. Stream Detection Test
Navigate to a page with streaming media (e.g., Canvas lecture, YouTube, Kaltura).

**Expected behavior:**
- Relay server console shows: `"📥 Processing stream with yt-dlp..."`
- yt-dlp downloads stream segments
- Transcription begins automatically

## Known Limitations

### 1. DRM-Protected Content
**Issue**: Widevine-encrypted streams cannot be decrypted.

**Affected**: Premium Netflix, Disney+, some textbook platforms

**Mitigation**: yt-dlp will download encrypted file but cannot play/transcribe it. This is a technical limitation, not a bug.

### 2. Cookie Expiration
**Issue**: Long downloads may expire session cookies.

**Mitigation**: yt-dlp establishes connection immediately, so cookies typically remain valid. For very long streams, refresh the page to get new cookies.

### 3. Chrome Web Store Compliance
**Issue**: `<all_urls>` permission triggers manual review warnings.

**Status**: Acceptable for personal/developer use. If publishing to Chrome Web Store, expect additional scrutiny.

## Troubleshooting

### "yt-dlp not found"
```bash
pip install yt-dlp
# Or force reinstall
npm run setup:install
```

### "WebSocket connection failed"
```bash
# Ensure relay server is running
npm run setup
# Choose option 2

# Check firewall isn't blocking localhost:8787
```

### "No streams detected"
- Open Chrome DevTools → Network tab
- Filter by `.m3u8` or `.mpd`
- If no results, the page isn't using HLS/DASH streams
- Try the old method (direct file links may still work via backward compatibility)

### "Download succeeded but file not found"
- Check `uploads/` directory for files starting with UUID
- Verify yt-dlp completed successfully (check relay server logs)
- File may have unexpected extension - this is now handled by scanning for `jobId` prefix

## Rollback (If Needed)

If you need to revert to the old DOM scraping version:

```bash
git checkout HEAD~1  # Go back one commit
npm run setup:install
```

## Support

For issues specific to:
- **yt-dlp**: https://github.com/yt-dlp/yt-dlp/issues
- **Stream detection**: Check Chrome DevTools → Console for extension logs
- **Cookie handling**: Verify cookies exist in Chrome DevTools → Application → Cookies
