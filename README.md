# MP3 Grabber & Auto-Transcription System

## Overview

The MP3 Grabber is an automated transcription system that captures MP3 audio links from web pages and transcribes them using **[faster-whisper](https://github.com/SYSTRAN/faster-whisper)** - a high-performance implementation of OpenAI's Whisper model with GPU acceleration support.

## Prerequisites

**Before running this project, you must have:**

- **Node.js** (version 14 or higher) - [Download here](https://nodejs.org/)
- **Python** (version 3.9 or higher) - [Download here](https://python.org/)
- **NVIDIA GPU** (optional) - For GPU acceleration

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
1. ✅ Check prerequisites (Node.js, Python)
2. 📦 Install all dependencies automatically
3. 🎮 Detect NVIDIA GPU and install CUDA libraries
4. 🐍 Set up faster-whisper with GPU support
5. 📁 Create necessary folders
6. 🚀 Present you with transcription options

### What You Get

After running `npm run setup`, you can choose:

1. **📁 File Transcription**: Process media files from the `media/` folder
2. **🌐 Extension Mode**: Start server for browser extension
3. **❌ Exit**: Close the application

## How It Works

### File Transcription Mode
1. Place media files in the `media/` folder
2. Run `npm run setup` → Select option 1
3. Choose your audio file
4. Watch real-time progress with GPU/CPU status
5. Get transcription saved to `transcriptions/` folder

### Extension Mode
1. Run `npm run setup` → Select option 2
2. Install browser extension from `extension/` folder
3. Navigate to any webpage with MP3 links
4. Press `Ctrl+Shift+M` to capture and transcribe
5. View results in real-time web interface

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

## File Structure

```
mp3grabber/
├── media/               # Place your audio/video files here
├── transcriptions/      # All transcription results saved here
├── extension/           # Browser extension files
├── relay.js            # Main server
├── start.js            # Setup script
└── viewer.html         # Web interface
```

## Troubleshooting

### Common Issues

**"Python not found"**
- Install Python 3.9+ from [python.org](https://python.org/)
- Make sure Python is added to your system PATH

**"Node.js not found"**
- Install Node.js 14+ from [nodejs.org](https://nodejs.org/)

**"GPU not working"**
- Install NVIDIA drivers and CUDA toolkit
- System will automatically fallback to CPU mode
- CPU mode works perfectly, just slower

**"No audio files found"**
- Place supported audio/video files in the `media/` folder
- Supported formats: .mp3, .wav, .m4a, .flac, .ogg, .webm, .mp4, .mkv, .avi

### Performance Tips

- **GPU**: Use NVIDIA GPU for 4x faster processing
- **File Size**: Smaller files process faster
- **Memory**: Ensure sufficient RAM for model loading
- **CPU**: Close other applications to free up resources

## Manual Commands (Advanced)

If you prefer manual setup:

```bash
# Install dependencies
npm install


# Install GPU libraries (optional)
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*

# Start relay server
npm start
```

## License

This project is open source. Please ensure you comply with OpenAI's Whisper license terms when using the Whisper models.