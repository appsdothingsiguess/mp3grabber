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

def transcribe_audio(audio_file, model_size="base", use_gpu=True):
    """Transcribe audio file using faster-whisper"""
    try:
        # Determine device and compute type
        device = "cuda" if use_gpu else "cpu"
        compute_type = "float16" if use_gpu else "int8"
        
        print(f"STATUS:Initializing {device.upper()} processing...", flush=True)
        
        # Load model with error handling
        print(f"STATUS:Loading Whisper model ({model_size})...", flush=True)
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        
        print(f"STATUS:Starting transcription...", flush=True)
        # Transcribe
        segments, info = model.transcribe(audio_file, beam_size=5)
        
        print(f"STATUS:Processing segments...", flush=True)
        # Collect segments
        transcript_text = ""
        segment_count = 0
        for segment in segments:
            transcript_text += segment.text.strip() + " "
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
    """Check if GPU is available and working"""
    try:
        import torch
        if torch.cuda.is_available():
            return True
    except ImportError:
        pass
    
    try:
        # Try to import CUDA libraries
        import nvidia.cublas.lib
        import nvidia.cudnn.lib
        return True
    except ImportError:
        return False

def save_transcription(transcript, audio_file, device, compute_type, language, confidence):
    """Save transcription to transcriptions folder"""
    try:
        # Get base filename without extension
        base_name = os.path.splitext(os.path.basename(audio_file))[0]
        
        # Create transcriptions directory if it doesn't exist
        transcriptions_dir = os.path.join(os.path.dirname(audio_file), "..", "transcriptions")
        os.makedirs(transcriptions_dir, exist_ok=True)
        
        # Create output file path
        output_file = os.path.join(transcriptions_dir, f"{base_name}.txt")
        
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
        const result = execSync(`python "${PYTHON_SCRIPT}" "${file}"`, {
            encoding: "utf8",
            cwd: __dirname
        });
        
        const transcriptionResult = JSON.parse(result.trim());
        
        if (transcriptionResult.success) {
            return transcriptionResult.transcript;
        } else {
            throw new Error(transcriptionResult.error);
        }
    } catch (error) {
        throw new Error(`Transcription failed: ${error.message}`);
    }
}

// --- Express Server ---
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'viewer.html')));

const server = app.listen(PORT, () => {
  console.log(`Relay server listening on port ${PORT}`);
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR);
  if (!existsSync(TRANSCRIPTIONS_DIR)) mkdirSync(TRANSCRIPTIONS_DIR);
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
  console.log('Relay client connected.');
  ws.on('close', () => console.log('Relay client disconnected.'));
  ws.on('error', error => console.error('WebSocket Error:', error));

  ws.on('message', async msg => {
    const messageString = msg.toString();
    console.log('Relay received:', messageString);

    const { url } = JSON.parse(messageString);
    if (!url) {
      console.warn('Received message without a URL.');
      return;
    }

    const jobId = uuidv4();
    let localFilePath = '';

    try {
      console.log(`Starting job ${jobId} for URL: ${url}`);
      const startMessage = JSON.stringify({
        type: 'new_transcription',
        payload: { url, id: jobId }
      });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(startMessage);
      });

      const fileExtension = path.extname(new URL(url).pathname);
      localFilePath = path.join(UPLOADS_DIR, `${jobId}${fileExtension}`);
      console.log(`[${jobId}] Downloading file to: ${localFilePath}`);
      await downloadFile(url, localFilePath);
      console.log(`[${jobId}] Download complete.`);

      console.log(`[${jobId}] Starting transcription...`);
      const transcript = transcribe(localFilePath);
      console.log(`[${jobId}] Transcription complete.`);

      const resultMessage = JSON.stringify({
        type: 'transcription_done',
        payload: { id: jobId, transcript }
      });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(resultMessage);
      });

    } catch (e) {
      console.error(`[${jobId}] Failed to process message:`, e);
      const errorMessage = JSON.stringify({
        type: 'transcription_failed',
        payload: { id: jobId, error: e.message }
      });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(errorMessage);
      });
    } finally {
      if (localFilePath) {
        unlink(localFilePath, err => {
          if (err) console.error(`[${jobId}] Error deleting temp file:`, err);
          else console.log(`[${jobId}] Cleaned up temp file: ${localFilePath}`);
        });
      }
    }
  });
});
