# MP3 Grabber & Auto-Transcription System NEW WORKING

## Overview

The MP3 Grabber is an automated transcription system that seamlessly captures MP3 audio links from web pages and transcribes them using AI-powered speech recognition. This project consists of three main components working together: a browser extension, a relay server, and integration with the Whishper transcription service.

## What This Project Does

1. **Detects MP3 Links**: Browser extension automatically finds MP3 audio links on any webpage
2. **Captures & Forwards**: Sends discovered URLs to a local relay server via WebSocket
3. **Auto-Transcribes**: Automatically submits audio files to Whishper (OpenAI Whisper) for transcription
4. **Real-time Updates**: Displays transcription progress and results in a web interface
5. **Batch Processing**: Handles multiple audio files simultaneously

## Architecture

```
[Web Page] → [Browser Extension] → [Relay Server] → [Whishper API]
     ↓              ↓                    ↓              ↓
[MP3 Links]    [WebSocket]         [Express Server]  [AI Transcription]
                    ↓                    ↓              ↓
              [User Interface] ← [Real-time Updates] ← [Results]
```

## Components

### 1. Browser Extension (`extension/`)

**File**: `extension/bg.js`, `extension/manifest.json`

- **Purpose**: Automatically detects MP3 links on web pages
- **Trigger**: Keyboard shortcut (`Ctrl+Shift+M` by default)
- **Functionality**:
  - Scans current webpage for MP3 links in `<a>`, `<audio>`, and `<source>` elements
  - Establishes WebSocket connection to relay server
  - Sends discovered URLs as JSON messages
  - Handles connection management and error recovery

**Key Features**:
- Non-intrusive: Only activates when triggered
- Smart detection: Finds MP3 links in various HTML elements
- Robust connectivity: Automatic reconnection handling
- Works on most websites (respects browser security policies)

### 2. Relay Server (`relay.js`)

**Purpose**: Central hub that coordinates between browser extension and transcription service

**Key Responsibilities**:
- **WebSocket Server**: Receives MP3 URLs from browser extension
- **API Gateway**: Forwards requests to Whishper transcription service
- **Web Interface**: Serves viewer page for monitoring transcriptions
- **Proxy Service**: Handles CORS and provides unified API access

**Technical Details**:
- Built with Express.js and WebSocket (`ws` library)
- Runs on port 8787 by default
- Provides REST API proxy for transcription status checks
- Real-time broadcasting to connected viewers

### 3. Viewer Interface (`viewer.html`)

**Purpose**: Web-based dashboard for monitoring transcription progress

**Features**:
- **Real-time Updates**: Shows incoming MP3 URLs as they're discovered
- **Progress Tracking**: Displays transcription status (Processing → Done/Failed)
- **Results Display**: Shows completed transcriptions with full text
- **Error Handling**: Clear indication of failed transcriptions

### 4. Whishper Integration

**Service**: [Whishper](https://github.com/pluja/whishper) - Self-hosted transcription service
- **AI Model**: OpenAI Whisper for speech-to-text conversion
- **Local Processing**: 100% private, no data sent to external services
- **Multiple Languages**: Automatic language detection
- **High Accuracy**: State-of-the-art speech recognition

## How It Works

### Step-by-Step Process

1. **Discovery Phase**:
   - User navigates to a webpage containing MP3 links
   - Presses `Ctrl+Shift+M` to activate the extension
   - Extension scans page DOM for MP3 URLs

2. **Capture Phase**:
   - Extension establishes WebSocket connection to relay server
   - Sends discovered URLs as JSON: `{"url": "https://example.com/audio.mp3"}`

3. **Processing Phase**:
   - Relay server receives URL and forwards to Whishper API
   - Whishper downloads audio file and begins transcription
   - API returns transcription job ID

4. **Monitoring Phase**:
   - Relay broadcasts URL + job ID to all connected viewers
   - Viewer interface begins polling for transcription status
   - Real-time updates show progress

5. **Completion Phase**:
   - Whishper completes transcription and returns full text
   - Viewer displays final transcription results
   - User can copy/use transcribed text

### Data Flow

```
Browser Extension → WebSocket → Relay Server → HTTP POST → Whishper API
                                     ↓
                              WebSocket Broadcast
                                     ↓
                               Viewer Interface → HTTP GET → Relay Proxy → Whishper API
```


## Technical Requirements

### System Requirements
- **Node.js**: Version 14 or higher
- **Browser**: Chrome, Firefox, or other modern browsers
- **Docker**: For running Whishper service
- **Network**: Local network access between components

### Dependencies
- **Express.js**: Web server framework
- **WebSocket (ws)**: Real-time communication
- **Whishper**: AI transcription service
- **Docker Compose**: Container orchestration

## Configuration

### Network Configuration
- **Relay Server**: `localhost:8787`
- **Whishper Service**: `192.168.1.96:8082` (configurable)
- **WebSocket**: Same port as relay server

### API Endpoints
- **Transcription Submit**: `POST /api/transcription`
- **Status Check**: `GET /api/transcriptions/{id}`
- **Viewer Interface**: `GET /`
