// relay.js
import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream, unlink } from 'fs';
import { get } from 'https';
import whisper from 'whisper-node';
import { v4 as uuidv4 } from 'uuid';

// --- Setup ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const wss = new WebSocketServer({ noServer: true });
const PORT = 8787;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// --- Express Server ---
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'viewer.html')));

const server = app.listen(PORT, () => {
    console.log(`Relay server listening on port ${PORT}`);
    // Ensure the uploads directory exists
    if (!require('fs').existsSync(UPLOADS_DIR)){
        require('fs').mkdirSync(UPLOADS_DIR);
    }
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
        get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            unlink(dest, () => {}); // Delete the file async
            reject(err.message);
        });
    });
}

// --- WebSocket Server Logic ---
wss.on('connection', ws => {
    console.log('Relay client connected.');
    ws.on('close', () => console.log('Relay client disconnected.'));
    ws.on('error', (error) => console.error('WebSocket Error:', error));

    ws.on('message', async (msg) => {
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
            // 1. Broadcast that we've started processing
            console.log(`Starting job ${jobId} for URL: ${url}`);
            const startMessage = JSON.stringify({ type: 'new_transcription', payload: { url, id: jobId } });
            wss.clients.forEach(client => client.readyState === WebSocket.OPEN && client.send(startMessage));

            // 2. Download the file
            const fileExtension = path.extname(new URL(url).pathname);
            localFilePath = path.join(UPLOADS_DIR, `${jobId}${fileExtension}`);
            console.log(`[${jobId}] Downloading file to: ${localFilePath}`);
            await downloadFile(url, localFilePath);
            console.log(`[${jobId}] Download complete.`);

            // 3. Transcribe the local file
            console.log(`[${jobId}] Starting transcription...`);
            const options = {
                modelName: "base.en", // or "small", "medium", etc.
                whisperOptions: {
                    language: 'auto',
                    gen_file_txt: false,
                    gen_file_subtitle: false,
                    gen_file_vtt: false,
                }
            };
            const transcript = await whisper(localFilePath, options);
            console.log(`[${jobId}] Transcription complete.`);

            // 4. Broadcast the result
            const resultMessage = JSON.stringify({ type: 'transcription_done', payload: { id: jobId, transcript } });
            wss.clients.forEach(client => client.readyState === WebSocket.OPEN && client.send(resultMessage));

        } catch (e) {
            console.error(`[${jobId}] Failed to process message:`, e);
            const errorMessage = JSON.stringify({ type: 'transcription_failed', payload: { id: jobId, error: e.message } });
            wss.clients.forEach(client => client.readyState === WebSocket.OPEN && client.send(errorMessage));
        } finally {
            // 5. Clean up the downloaded file
            if (localFilePath) {
                unlink(localFilePath, (err) => {
                    if (err) console.error(`[${jobId}] Error deleting temp file ${localFilePath}:`, err);
                    else console.log(`[${jobId}] Cleaned up temp file: ${localFilePath}`);
                });
            }
        }
    });
});