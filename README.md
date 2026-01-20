# MP3 Grabber & Auto-Transcription System

## Overview

The MP3 Grabber is a comprehensive automated transcription system that captures audio/video files from local storage or web pages and transcribes them using **[faster-whisper](https://github.com/SYSTRAN/faster-whisper)** - a high-performance implementation of OpenAI's Whisper model with GPU acceleration support.

**NEW in v0.4**: Network sniffing architecture for HLS/DASH stream support and authenticated content (Canvas, Kaltura, Panopto).

### Key Features at a Glance

- 🎯 **Local & Web-Based Transcription**: Process files from disk or capture from web pages
- 🌊 **HLS/DASH Stream Support**: Automatically detects and downloads `.m3u8` and `.mpd` streams
- 🔐 **Authenticated Content**: Captures session cookies for Canvas, Kaltura, Panopto
- ⚡ **GPU Acceleration**: 4x faster with NVIDIA CUDA support, automatic CPU fallback
- 🌐 **Browser Extension**: Chrome extension with passive network interception
- 📊 **Real-Time Progress**: Live WebSocket updates and progress tracking
- 🔒 **100% Privacy**: All processing happens locally on your machine
- 🎬 **Multi-Format Support**: Audio (MP3, M4A, WAV, FLAC, OGG, WebM) and Video (MP4, MKV, AVI)
- 📝 **Timestamped Output**: Transcriptions include precise timestamps for each segment

## Prerequisites

**Before running this project, you must have:**

- **Node.js** (version 14 or higher) - [Download here](https://nodejs.org/)
- **Python** (version 3.10 - 3.12) - [Download here](https://python.org/)
- **yt-dlp** (installed automatically by setup script) - For stream downloading
- **ffmpeg** (installed automatically by setup script) - For stream processing
- **NVIDIA GPU** (optional) - For GPU acceleration with CUDA

**Note**: yt-dlp and ffmpeg are automatically installed during setup. If auto-installation fails, manual installation instructions will be provided.

## Quick Start

### One-Time Setup Command

```bash
npm run setup
```

### Force Reinstall (if needed)

```bash
npm run setup:install
```

**That's it!** This single command will:
1. ✅ Check prerequisites (Node.js, Python, yt-dlp, ffmpeg)
2. 📦 Install all dependencies automatically (including ffmpeg)
3. 🎮 Detect NVIDIA GPU and install CUDA libraries
4. 🐍 Set up faster-whisper with GPU support
5. 📁 Create necessary folders and configuration files
6. 🚀 Present you with transcription options

### What You Get

After running `npm run setup`, you can choose:

1. **📁 File Transcription**: Process media files from the `media/` folder
2. **🌐 Extension Mode**: Start WebSocket server for browser extension
3. **❌ Exit**: Close the application

## How It Works

### File Transcription Mode

1. **Place Files**: Add audio/video files to the `media/` folder
2. **Run Setup**: Execute `npm run setup` → Select option 1
3. **Choose File**: Select from the list of available media files
4. **Watch Progress**: Real-time status updates with GPU/CPU detection
5. **Get Results**: Transcription automatically saved to `transcriptions/` folder with metadata

**Features:**
- Real-time progress updates during transcription
- Automatic GPU detection and CPU fallback
- Segment-by-segment processing with progress indicators
- Timestamped output with `[MM:SS.mmm]` format
- Metadata includes device used, language detected, and confidence scores

### Extension Mode (Browser-Based Transcription)

1. **Start Server**: Run `npm run setup` → Select option 2
2. **Install Extension**: 
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `extension/` folder
3. **Capture Audio**:
   - Navigate to any webpage with audio/video content (including HLS/DASH streams)
   - **Automatic detection**: Streams are captured automatically when detected
   - **Manual trigger** (optional): Press `Ctrl+Shift+M` to verify connection
   - Extension captures stream URLs with session cookies
4. **View Progress**: Open `http://localhost:8787` for real-time transcription status
5. **Get Results**: Transcriptions saved to `transcriptions/` folder with unique IDs

**Extension Features:**
- **Network sniffing**: Passively monitors network requests for streaming content
- **HLS/DASH support**: Detects `.m3u8` and `.mpd` manifests automatically
- **Cookie extraction**: Captures session cookies for authenticated content
- **yt-dlp integration**: Uses industry-standard downloader for complex streams
- **WebSocket communication**: Real-time updates to relay server
- **Debounce mechanism**: Prevents duplicate stream captures
- **Live viewer interface** at `http://localhost:8787`

**Supported Platforms:**
- ✅ Canvas LMS
- ✅ Kaltura
- ✅ Panopto
- ✅ AWS CloudFront signed URLs
- ✅ YouTube (HLS streams)
- ✅ Any platform using HLS/DASH protocols
- ✅ Direct audio/video file links

**Extension Limitations:**
- ❌ **DRM-protected content**: Widevine encryption cannot be bypassed (Netflix, Disney+)
- ⚠️  **Cookie expiration**: Very long downloads may expire session cookies
- ⚠️  **Network detection**: Page must actively request `.m3u8` or `.mpd` files

## Features

### 🚀 **High Performance**
- **4x faster** than original Whisper
- **50% less memory** usage
- **GPU acceleration** with NVIDIA CUDA support
- **Automatic CPU fallback** if GPU unavailable

### 🎯 **Smart Processing**
- **Real-time progress bars** during transcription
- **GPU/CPU status display** 
- **Automatic language detection**
- **High accuracy** speech recognition

### 🔒 **Privacy & Security**
- **100% local processing** - no data sent to external services
- **Temporary files** automatically cleaned up
- **Your data stays on your machine**

### 📁 **Organized Output**
- All transcriptions saved to `transcriptions/` folder
- Original media files remain in `media/` folder
- Clean, organized file structure

## Supported Audio & Video Formats

The system supports all these formats for both file transcription and browser extension:

**Audio Formats:**
- **MP3** (`.mp3`) - Most common
- **WAV** (`.wav`) - Uncompressed
- **M4A** (`.m4a`) - Apple format ⭐ *Now supported by browser extension*
- **FLAC** (`.flac`) - Lossless
- **OGG** (`.ogg`) - Open source
- **WebM** (`.webm`) - Web format

**Video Formats (audio track extracted automatically):**
- **MP4** (`.mp4`) - Common video format
- **MKV** (`.mkv`) - Matroska video
- **AVI** (`.avi`) - Audio Video Interleave

## Architecture & File Structure

### Project Structure

```
mp3grabber/
├── media/                    # Place your audio/video files here
│   └── README.md            # Media folder documentation
├── transcriptions/          # All transcription results saved here
│   └── README.md            # Transcriptions folder documentation
├── uploads/                 # Temporary files from browser extension
├── downloads/               # Temporary cookie files for yt-dlp
├── extension/               # Browser extension files
│   ├── manifest.json        # Extension configuration (v3)
│   ├── bg.js               # Background service worker
│   ├── content.js          # (DEPRECATED - no longer used)
│   └── README.md           # Extension documentation
├── whisper-bin/             # Whisper model cache (auto-created)
├── config.json             # Installation state tracking
├── package.json            # Node.js dependencies
├── requirements.txt        # Python dependencies
├── start.js                # Interactive setup and menu system
├── relay.js                # Express + WebSocket server
├── transcribe.py           # Python transcription script (faster-whisper)
├── viewer.html             # Real-time web UI for transcriptions
├── MIGRATION_GUIDE.md      # v0.3 → v0.4 upgrade guide
├── IMPLEMENTATION_SUMMARY.md # Technical implementation details
└── README.md               # This file
```

### Technical Architecture

**v0.4 Architecture (Network Sniffing):**

```
┌─────────────┐
│ Web Browser │
└──────┬──────┘
       │ Network Requests (.m3u8, .mpd)
       ▼
┌──────────────────────┐
│ Chrome Extension     │
│ (bg.js)              │
│ - webRequest API     │
│ - Cookie extraction  │
└──────┬───────────────┘
       │ WebSocket (stream_found + cookies)
       ▼
┌──────────────────────┐
│ Relay Server         │
│ (relay.js)           │
│ - Cookie → Netscape  │
│ - Spawn yt-dlp       │
└──────┬───────────────┘
       │ Execute with cookies
       ▼
┌──────────────────────┐
│ yt-dlp               │
│ - Download HLS/DASH  │
│ - Handle auth        │
└──────┬───────────────┘
       │ Downloaded file
       ▼
┌──────────────────────┐
│ Transcription Engine │
│ (transcribe.py)      │
│ - faster-whisper     │
│ - GPU/CPU support    │
└──────────────────────┘
```

**Backend Stack:**
- **Node.js** (Express): HTTP server and WebSocket management
- **yt-dlp**: Stream downloader with cookie authentication
- **Python** (faster-whisper): Audio transcription engine
- **WebSocket (ws)**: Real-time bidirectional communication
- **CUDA** (optional): GPU acceleration for transcription

**Frontend Stack:**
- **Chrome Extension (Manifest V3)**: Audio capture and injection
- **Vanilla JavaScript**: Real-time viewer interface
- **WebSocket Client**: Live status updates

**Data Flow:**
1. **File Mode**: `media/` → `start.js` → `transcribe.py` → `transcriptions/`
2. **Extension Mode**: `webpage` → `extension` → `WebSocket` → `relay.js` → `transcribe.py` → `transcriptions/`

## Troubleshooting

### Common Issues

**"yt-dlp not found"**
```bash
pip install yt-dlp
# Or force reinstall
npm run setup:install
```

**"WebSocket connection failed"**
- Ensure relay server is running: `npm run setup` → option 2
- Check firewall isn't blocking `localhost:8787`
- Verify extension is loaded in Chrome

**"No streams detected"**
- Open Chrome DevTools → Network tab
- Filter by `.m3u8` or `.mpd`
- If no results, page isn't using HLS/DASH
- Try direct file links (backward compatible)

**"Download succeeded but file not found"**
- Check `uploads/` directory for UUID-prefixed files
- Verify yt-dlp completed (check relay server logs)
- Extension may need reload

### Migrating from v0.3

If you're upgrading from the old DOM scraping version, see [`MIGRATION_GUIDE.md`](MIGRATION_GUIDE.md) for:
- Architecture comparison
- Breaking changes
- Testing procedures
- Rollback instructions

### Common Issues

**"Python not found"**
- Install Python 3.9+ from [python.org](https://python.org/)
- Make sure Python is added to your system PATH
- On Windows, check "Add Python to PATH" during installation

**"Node.js not found"**
- Install Node.js 14+ from [nodejs.org](https://nodejs.org/)
- Verify installation: `node --version`

**"GPU not working"**
- Install NVIDIA drivers from [nvidia.com](https://nvidia.com)
- Install CUDA Toolkit 12.x from [NVIDIA CUDA Downloads](https://developer.nvidia.com/cuda-downloads)
- System will automatically fallback to CPU mode if GPU unavailable
- CPU mode works perfectly, just 2-4x slower

**"No audio files found"**
- Place supported audio/video files in the `media/` folder
- Supported formats: .mp3, .wav, .m4a, .flac, .ogg, .webm, .mp4, .mkv, .avi
- Files must have the correct file extension

**"WebSocket connection failed"**
- Make sure relay server is running (`npm run setup` → Option 2)
- Check if port 8787 is available (not used by another application)
- Verify firewall isn't blocking local connections
- Try restarting the server

**"Extension not working"**
- Reload the extension in `chrome://extensions/`
- Check browser console (F12) for error messages
- Ensure relay server is running before using extension
- Extension works best with direct audio file links

**"Transcription takes too long"**
- GPU mode is 4x faster - ensure CUDA is properly installed
- Use smaller audio files for faster processing
- Close other GPU-intensive applications
- CPU mode is slower but equally accurate

**"Module not found" errors**
- Run `npm run setup:install` to force reinstall
- Verify all dependencies installed: `npm install`
- For Python dependencies: `pip install faster-whisper`

### Performance Tips

- **GPU Acceleration**: Use NVIDIA GPU with CUDA for 4x faster processing
- **Model Size**: GPU uses "medium" model, CPU uses "base" model for better performance
- **File Size**: Smaller files (< 10 minutes) process faster
- **Memory**: Ensure at least 4GB RAM (8GB+ recommended for GPU mode)
- **CPU**: Close other applications to free up resources
- **Batch Processing**: Process multiple files sequentially for efficiency

### Advanced Configuration

**Changing Whisper Model Size:**
Edit `transcribe.py` lines 602-608 to adjust model size:
- `tiny`: Fastest, least accurate
- `base`: Fast, good accuracy (CPU default)
- `small`: Balanced
- `medium`: High accuracy (GPU default)
- `large`: Highest accuracy, slowest

**Changing Server Port:**
Edit `relay.js` line 15 and `extension/bg.js` line 1 to change port from 8787

**GPU Memory Issues:**
If GPU runs out of memory, edit `transcribe.py` line 458 to use `compute_type="int8"` instead of `"float16"`

## Transcription Output Format

Transcription files in the `transcriptions/` folder include:

```
Transcription Results
Generated: 2024-10-26 15:39:48
Source: voice-message.mp3
Device: GPU
Compute Type: float16
Model Size: medium
Language: en (99.8% confidence)

--- TRANSCRIPTION ---
[00:00.000] Welcome to the MP3 Grabber transcription system.
[00:05.230] This is a demonstration of the timestamped output format.
[00:10.450] Each segment includes precise timing information.
```

**Output Features:**
- Header with metadata (device, model, language, confidence)
- Timestamps in `[MM:SS.mmm]` format
- UTF-8 encoding for international characters
- Automatic line breaks for readability
- Source file tracking

## Dependencies

### Node.js Packages
- `express` ^4.19.2 - Web server framework
- `ws` ^8.17.0 - WebSocket implementation
- `node-fetch` ^3.3.2 - HTTP client
- `uuid` ^9.0.1 - Unique ID generation

### Python Packages
- `faster-whisper` - High-performance Whisper implementation
- `yt-dlp` - Stream downloader with HLS/DASH support
- `nvidia-cublas-cu12` (optional) - CUDA linear algebra library
- `nvidia-cudnn-cu12==9.*` (optional) - CUDA deep neural network library

All dependencies are automatically installed via `npm run setup` or can be installed manually via `pip install -r requirements.txt`.

## Manual Commands (Advanced)

If you prefer manual setup:

```bash
# Install Node.js dependencies
npm install

# Install Python dependencies from requirements.txt
pip install -r requirements.txt

# Or install individually:
pip install faster-whisper yt-dlp

# Install GPU libraries (optional, for NVIDIA GPUs)
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*

# Run file transcription mode
npm run setup
# Then select option 1

# Start relay server for extension mode
npm start
# or
node relay.js

# Force reinstall all dependencies
npm run setup:install
```

### Direct Python Usage

You can also use the transcription script directly:

```bash
python transcribe.py path/to/audio/file.mp3
```

Output is JSON with transcription results:
```json
{
  "success": true,
  "transcript": "[00:00.000] Transcribed text...",
  "language": "en",
  "language_probability": 0.998,
  "device": "cuda",
  "compute_type": "float16",
  "model_size": "medium",
  "segment_count": 42,
  "output_file": "path/to/transcriptions/file.txt"
}
```

## Security & Privacy

- ✅ **100% Local Processing**: No data sent to external servers
- ✅ **No Cloud Dependencies**: Everything runs on your machine
- ✅ **No Telemetry**: No usage tracking or analytics
- ✅ **Temporary File Cleanup**: Extension downloads are automatically deleted after processing
- ✅ **Open Source**: Full transparency - inspect all code
- ⚠️ **Network**: Browser extension communicates with local WebSocket server only (localhost:8787)

## Contributing

This project is open for contributions. Key areas for improvement:
- Additional language support and optimization
- Better YouTube integration (within legal/technical limits)
- UI/UX improvements for the web viewer
- Additional audio source integrations
- Performance optimizations

## Known Limitations

1. **YouTube**: Videos may be encrypted or DRM-protected, limiting direct access
2. **Streaming Services**: Many use DRM protection that prevents audio capture
3. **CORS**: Some websites block cross-origin requests
4. **File Size**: Very large files (>2 hours) may require significant processing time
5. **GPU Memory**: Large models on consumer GPUs may require lower precision settings

## License

This project is open source. Please ensure you comply with:
- OpenAI's Whisper license terms when using the Whisper models
- faster-whisper project license terms
- Applicable laws regarding audio recording and transcription in your jurisdiction

## Acknowledgments

- **[faster-whisper](https://github.com/SYSTRAN/faster-whisper)** by SYSTRAN - High-performance Whisper implementation
- **[OpenAI Whisper](https://github.com/openai/whisper)** - Original speech recognition model
- **NVIDIA CUDA** - GPU acceleration framework