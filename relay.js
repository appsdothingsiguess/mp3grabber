// relay.js
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const wss = new WebSocketServer({ noServer: true });
const PORT = 8787;

// --- Whishper Configuration ---
// It's good practice to use environment variables for configuration.
const WHISHPER_API_BASE_URL = process.env.WHISHPER_API_URL || 'http://192.168.1.96:8082/api';
const WHISHPER_SUBMIT_URL = `${WHISHPER_API_BASE_URL}/transcription`;

// serve the viewer page
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'viewer.html')));

// Proxy endpoint to fetch transcription status/result from Whishper
app.get('/api/transcriptions/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[Proxy] Received request for transcription ID: ${id}`);
  try {
    const whishperUrl = `${WHISHPER_API_BASE_URL}/transcriptions/${id}`;
    console.log(`[Proxy] Forwarding request to: ${whishperUrl}`);
    const whishperResponse = await fetch(whishperUrl);
    const data = await whishperResponse.json();
    console.log(`[Proxy] Received response from Whishper for ID ${id}:`, data);
    res.status(whishperResponse.status).json(data);
  } catch (e) {
    console.error(`[Proxy] Failed to proxy request for transcription ${id}:`, e);
    res.status(500).json({ error: 'Failed to connect to Whishper API' });
  }
});

// upgrade to WS
const server = app.listen(PORT, () => console.log(`Relay server listening on port ${PORT}`));
server.on('upgrade', (req, sock, head) => {
  wss.handleUpgrade(req, sock, head, ws => {
    wss.emit('connection', ws, req);
  });
});

// broadcast any message to all connected viewers
wss.on('connection', ws => {
  console.log('Relay client connected.');
  ws.on('close', () => console.log('Relay client disconnected.'));

  ws.on('message', async (msg) => {
    const messageString = msg.toString();
    console.log('Relay received:', messageString);
    
    try {
      const { url } = JSON.parse(messageString);
      if (!url) return;

      console.log(`Forwarding URL to Whishper: ${url}`);
      const response = await fetch(WHISHPER_SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: url,
          language: "auto", // Specify language detection
          task: "transcribe" // Specify the task
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whishper API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const responseData = await response.json();
      const id = responseData.id;

      if (!id) {
        throw new Error('Whishper API did not return an ID.');
      }

      console.log(`Received transcription ID from Whishper: ${id}`);
      
      const broadcastMessage = JSON.stringify({ url, id });
      console.log(`Broadcasting to viewers: ${broadcastMessage}`);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMessage);
        }
      }

    } catch (e) {
      console.error('Failed to process message or send request to Whishper:', e);
    }
  });
});
