// relay.js
import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream, unlink, existsSync, mkdirSync } from 'fs';
import { get } from 'https';
import { execFileSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';

// --- Setup ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const wss = new WebSocketServer({ noServer: true });
const PORT = 8787;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const BIN_DIR = path.join(__dirname, 'whisper-bin');

const MAIN = path.join(BIN_DIR, 'whisper-cli.exe'); // Portable binary
const MODEL = path.join(BIN_DIR, 'ggml-base.bin'); // Or your downloaded model

if (!existsSync(MAIN)) {
  throw new Error(`Missing Whisper binary at: ${MAIN}`);
}
if (!existsSync(MODEL)) {
  throw new Error(`Missing Whisper model at: ${MODEL}`);
}

function transcribe(file) {
    const jsonPath = file + ".json";  // Whisper saves to this automatically
    execFileSync(
      MAIN,
      ["-m", MODEL, "-f", file, "-oj"], // still outputs to file, not stdout
      { encoding: "utf8" }
    );
    const jsonContent = readFileSync(jsonPath, "utf8");
    const parsed = JSON.parse(jsonContent);
    unlink(jsonPath, () => {}); // optional cleanup
    return parsed.text;
  }

// --- Express Server ---
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'viewer.html')));

const server = app.listen(PORT, () => {
  console.log(`Relay server listening on port ${PORT}`);
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR);
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
