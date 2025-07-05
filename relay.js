// relay.js
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const wss = new WebSocketServer({ noServer: true });
const PORT = 8787;

// serve the viewer page
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'viewer.html')));

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
  ws.on('message', msg => {
    // msg is a Buffer, so convert it to a string.
    const messageString = msg.toString();
    console.log('Relay received:', messageString);
    // broadcast to all clients
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageString);
      }
    }
  });
});
