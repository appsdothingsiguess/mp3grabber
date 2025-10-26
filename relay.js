// relay.js
import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream, unlink, existsSync, mkdirSync, writeFileSync } from 'fs';
import { get } from 'https';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

// --- Setup ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const wss = new WebSocketServer({ noServer: true });
const PORT = 8787;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TRANSCRIPTIONS_DIR = path.join(__dirname, 'transcriptions');
const PYTHON_SCRIPT = path.join(__dirname, 'transcribe.py');

// Create Python transcription script if it doesn't exist
if (!existsSync(PYTHON_SCRIPT)) {
  const pythonScript = `#!/usr/bin/env python3
import sys
import os
import warnings
import json
from datetime import datetime
from faster_whisper import WhisperModel

# Suppress warnings for cleaner output
warnings.filterwarnings("ignore", category=UserWarning)

def transcribe_audio(audio_file, model_size="medium", use_gpu=True):
    """Transcribe audio file using faster-whisper"""
    try:
        # Determine device and compute type
        device = "cuda" if use_gpu else "cpu"
        # Use float32 for CPU to get better quality (int8 quantizes and reduces accuracy)
        # For GPU, use float16 for speed/quality balance
        compute_type = "float16" if use_gpu else "float32"
        
        print(f"STATUS:Initializing {device.upper()} processing...", flush=True)
        
        # Check file type and provide info
        file_ext = os.path.splitext(audio_file)[1].lower()
        if file_ext in ['.mp4', '.webm', '.mkv', '.avi']:
            print(f"STATUS:Processing video file ({file_ext}) - extracting audio track...", flush=True)
        else:
            print(f"STATUS:Processing audio file ({file_ext})...", flush=True)
        
        # Load model with error handling
        print(f"STATUS:Loading Whisper model ({model_size})...", flush=True)
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        
        print(f"STATUS:Starting transcription...", flush=True)
        # Transcribe (faster-whisper automatically handles video files by extracting audio)
        segments, info = model.transcribe(audio_file, beam_size=5)
        
        print(f"STATUS:Processing segments...", flush=True)
        # Collect segments with timestamps
        transcript_text = ""
        segment_count = 0
        for segment in segments:
            start_time = segment.start
            end_time = segment.end
            # Format timestamps as [MM:SS.mmm]
            start_formatted = f"[{int(start_time//60):02d}:{start_time%60:06.3f}]"
            end_formatted = f"[{int(end_time//60):02d}:{end_time%60:06.3f}]"
            transcript_text += f"{start_formatted} {segment.text.strip()}\\n"
            segment_count += 1
            if segment_count % 10 == 0:  # Progress update every 10 segments
                print(f"STATUS:Processed {segment_count} segments...", flush=True)
        
        print(f"STATUS:Transcription complete!", flush=True)
        
        return {
            "success": True,
            "transcript": transcript_text.strip(),
            "language": info.language,
            "language_probability": info.language_probability,
            "device": device,
            "compute_type": compute_type,
            "segment_count": segment_count
        }
        
    except Exception as e:
        error_msg = str(e)
        return {
            "success": False,
            "error": error_msg,
            "device": device,
            "compute_type": compute_type
        }

def check_gpu_availability():
    """Check if GPU libraries are available"""
    # Debug: print what we're checking
    print("DEBUG:Checking GPU availability...", flush=True)
    
    # First try torch (most reliable)
    try:
        import torch
        print(f"DEBUG:torch imported, cuda available: {torch.cuda.is_available()}", flush=True)
        if torch.cuda.is_available():
            print("DEBUG:GPU available via torch.cuda", flush=True)
            return True
    except ImportError as e:
        print(f"DEBUG:torch not available: {e}", flush=True)
        pass
    
    # Then try CUDA libraries
    try:
        import nvidia.cublas
        import nvidia.cudnn
        print("DEBUG:CUDA libraries imported successfully", flush=True)
        # If we can import both, assume GPU is available
        # The actual transcription will fallback to CPU if GPU fails
        return True
    except ImportError as e:
        print(f"DEBUG:CUDA libraries not available: {e}", flush=True)
        return False

def save_transcription(transcript, audio_file, device, compute_type, language, confidence):
    """Save transcription to transcriptions folder"""
    try:
        # Get base filename without extension
        base_name = os.path.splitext(os.path.basename(audio_file))[0]
        
        # Create transcriptions directory if it doesn't exist
        transcriptions_dir = os.path.join(os.path.dirname(audio_file), "..", "transcriptions")
        os.makedirs(transcriptions_dir, exist_ok=True)
        
        # Create output file path with timestamp suffix to avoid overwriting
        timestamp_suffix = datetime.now().strftime('%Y%m%d_%H%M%S')
        output_file = os.path.join(transcriptions_dir, f"{base_name}_{timestamp_suffix}.txt")
        
        # Create header with metadata
        header = f"""Transcription Results
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
Source: {os.path.basename(audio_file)}
Device: {device.upper()}
Compute Type: {compute_type}
Language: {language} ({confidence:.1%} confidence)

--- TRANSCRIPTION ---
"""
        
        # Write to file
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(header)
            f.write(transcript)
        
        return output_file
    except Exception as e:
        return None

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"success": False, "error": "Usage: python transcribe.py <audio_file>"}))
        sys.exit(1)
    
    audio_file = sys.argv[1]
    if not os.path.exists(audio_file):
        print(json.dumps({"success": False, "error": f"Audio file not found: {audio_file}"}))
        sys.exit(1)
    
    # Check GPU availability first
    gpu_available = check_gpu_availability()
    
    # Try GPU first if available, otherwise use CPU
    if gpu_available:
        result = transcribe_audio(audio_file, use_gpu=True)
        if not result["success"] and ("CUDA" in result["error"] or "cudnn" in result["error"].lower() or "cublas" in result["error"].lower()):
            # Fallback to CPU if GPU fails
            result = transcribe_audio(audio_file, use_gpu=False)
    else:
        # Use CPU directly
        result = transcribe_audio(audio_file, use_gpu=False)
    
    # Save transcription if successful
    if result["success"]:
        output_file = save_transcription(
            result["transcript"], 
            audio_file, 
            result["device"], 
            result["compute_type"],
            result["language"],
            result["language_probability"]
        )
        if output_file:
            result["output_file"] = output_file
    
    print(json.dumps(result))
`;
  writeFileSync(PYTHON_SCRIPT, pythonScript);
}

function transcribe(file) {
    try {
        console.log(`🔄 Transcribing audio file...`);
        const result = execSync(`python "${PYTHON_SCRIPT}" "${file}"`, {
            encoding: "utf8",
            cwd: __dirname
        });
        
        // Parse the output to extract JSON result
        const lines = result.trim().split('\n');
        let jsonResult = null;
        
        // Find the JSON line (should be the last line that starts with {)
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.startsWith('{') && line.endsWith('}')) {
                try {
                    jsonResult = JSON.parse(line);
                    break;
                } catch (parseError) {
                    continue;
                }
            }
        }
        
        if (!jsonResult) {
            throw new Error(`No valid JSON found in output. Raw output: ${result}`);
        }
        
        if (jsonResult.success) {
            console.log(`✅ Transcription complete!`);
            return jsonResult.transcript;
        } else {
            throw new Error(jsonResult.error || 'Transcription failed');
        }
    } catch (error) {
        console.error(`Relay: Transcription error:`, error);
        throw new Error(`Transcription failed: ${error.message}`);
    }
}

// --- Express Server ---
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'viewer.html')));

const server = app.listen(PORT, () => {
  console.log(`🚀 Relay server listening on port ${PORT}`);
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR);
  if (!existsSync(TRANSCRIPTIONS_DIR)) mkdirSync(TRANSCRIPTIONS_DIR);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down relay server...');
  server.close(() => {
    console.log('✅ Relay server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down relay server...');
  server.close(() => {
    console.log('✅ Relay server closed');
    process.exit(0);
  });
});

server.on('upgrade', (req, sock, head) => {
  wss.handleUpgrade(req, sock, head, ws => {
    wss.emit('connection', ws, req);
  });
});

// --- Helper Function to Download a File ---
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    get(url, response => {
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      unlink(dest, () => {});
      reject(err.message);
    });
  });
}

// --- WebSocket Server Logic ---
wss.on('connection', ws => {
  console.log('🌐 Client connected');
  
  ws.on('close', (code, reason) => {
    console.log('🔌 Client disconnected');
  });
  
  ws.on('error', error => {
    console.error('WebSocket Error:', error);
  });

  ws.on('message', async msg => {
    const messageString = msg.toString();
    console.log('📨 Received message:', messageString);

    try {
      const parsedMessage = JSON.parse(messageString);
      const { type, url, data, mimeType, size, originalUrl, element, source, pageUrl } = parsedMessage;
      
      if (!type) {
        console.warn('⚠️  Received message without a type');
        return;
      }

      const jobId = uuidv4();
      let localFilePath = '';

      try {
        console.log(`🔄 Starting transcription job: ${jobId}`);
        const startMessage = JSON.stringify({
          type: 'new_transcription',
          payload: { 
            id: jobId, 
            source: source || 'unknown',
            element: element || 'unknown',
            pageUrl: pageUrl || 'unknown'
          }
        });
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.send(startMessage);
        });

        if (type === 'blob') {
          // Handle blob data
          console.log(`📥 Processing blob data (${size} bytes, ${mimeType})...`);
          
          // Determine file extension from MIME type
          let fileExtension = '.mp3'; // default
          if (mimeType) {
            if (mimeType.includes('mp4')) fileExtension = '.mp4';
            else if (mimeType.includes('webm')) fileExtension = '.webm';
            else if (mimeType.includes('ogg')) fileExtension = '.ogg';
            else if (mimeType.includes('wav')) fileExtension = '.wav';
            else if (mimeType.includes('flac')) fileExtension = '.flac';
            else if (mimeType.includes('m4a')) fileExtension = '.m4a';
            else if (mimeType.includes('mp3')) fileExtension = '.mp3';
          }
          
          localFilePath = path.join(UPLOADS_DIR, `${jobId}${fileExtension}`);
          
          // Convert base64 to file
          const buffer = Buffer.from(data, 'base64');
          writeFileSync(localFilePath, buffer);
          console.log('✅ Blob data saved to file');

        } else if (type === 'url') {
          // Handle regular URL
          if (!url) {
            throw new Error('URL is required for type "url"');
          }
          
          console.log('📥 Downloading audio file...');
          const fileExtension = path.extname(new URL(url).pathname) || '.mp3';
          localFilePath = path.join(UPLOADS_DIR, `${jobId}${fileExtension}`);
          await downloadFile(url, localFilePath);
          console.log('✅ Download complete');
          
        } else {
          throw new Error(`Unknown message type: ${type}`);
        }

        console.log('🔄 Starting transcription...');
        const transcript = transcribe(localFilePath);

        const resultMessage = JSON.stringify({
          type: 'transcription_done',
          payload: { 
            id: jobId, 
            transcript,
            source: source || 'unknown',
            element: element || 'unknown',
            pageUrl: pageUrl || 'unknown'
          }
        });
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.send(resultMessage);
        });

      } catch (e) {
        console.error(`❌ Transcription failed:`, e.message);
        const errorMessage = JSON.stringify({
          type: 'transcription_failed',
          payload: { 
            id: jobId, 
            error: e.message,
            source: source || 'unknown',
            element: element || 'unknown',
            pageUrl: pageUrl || 'unknown'
          }
        });
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.send(errorMessage);
        });
      } finally {
        if (localFilePath) {
          unlink(localFilePath, err => {
            if (err) console.error(`⚠️  Error deleting temp file:`, err);
          });
        }
      }
    } catch (parseError) {
      console.error('❌ Failed to parse message:', parseError.message);
    }
  });
});
