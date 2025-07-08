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
import fetch from 'node-fetch'; // For Gemini API call
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- Gemini Configuration ---
// WARNING: Hardcoding keys is not recommended.
// For better security, use environment variables.
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY_HERE"; // Replace with your key
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;

// --- Setup ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const wss = new WebSocketServer({ noServer: true });
const PORT = 8787;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const BIN_DIR = path.join(__dirname, 'whisper-bin');

const MAIN = path.join(BIN_DIR, 'whisper-cli.exe'); // Portable binary
const MODEL = path.join(BIN_DIR, 'ggml-base.bin'); // Or your downloaded model

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

if (!existsSync(MAIN)) {
  throw new Error(`Missing Whisper binary at: ${MAIN}`);
}
if (!existsSync(MODEL)) {
  throw new Error(`Missing Whisper model at: ${MODEL}`);
}

function transcribe(file) {
    const jsonPath = file + ".json";
    try {
        console.log(`[transcribe] Executing Whisper CLI for file: ${file}`);
        execFileSync(
            MAIN,
            ["-m", MODEL, "-f", file, "-oj"],
            { encoding: "utf8", windowsHide: true }
        );
    } catch (error) {
        console.error("[transcribe] Error executing Whisper CLI:", error.message);
        throw new Error("Whisper transcription process failed.");
    }

    if (!existsSync(jsonPath)) {
        console.error(`[transcribe] Whisper did not create the output JSON file: ${jsonPath}`);
        throw new Error("Whisper failed to produce an output file.");
    }
    
    const jsonContent = readFileSync(jsonPath, "utf8");
    unlink(jsonPath, () => {}); // optional cleanup
    
    // Return the entire parsed object so we can choose what to use later.
    return JSON.parse(jsonContent);
  }

async function analyzeAndAnswerWithGemini(pageText, itemCount, transcriptText) {
    console.log("analyzeAndAnswerWithGemini: Asking Gemini to analyze task type and provide answers using JSON Mode.");
    
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: {
            responseMimeType: "application/json",
        },
    });
    const prompt = `
        You are an AI assistant for a transcription tool. Your task is to analyze the user's web page content and an audio transcript to determine the required action and provide the answers in a specific JSON format.

        There are two possible task types:
        1.  "true-false": This is for quizzes with True/False questions.
        2.  "dictation": This is for exercises where the user needs to write down what they hear.

        Analyze the following inputs:
        - Page Context: The text content of the web page.
        - Item Count: The number of questions or input fields found on the page.
        - Transcript: The raw text from the audio.

        Based on your analysis, determine the 'taskType'.

        - If the task is "true-false", analyze the transcript to determine the correct True or False answer for each of the ${itemCount} items on the page.
        - If the task is "dictation", clean up the transcript and split it into distinct sentences. The number of sentences may not match the item count.

        CRITICAL: Your response must be a single, minified, valid JSON object and nothing else. Do not include markdown formatting, backticks, or any explanatory text.

        The JSON object must contain two keys:
        1.  "taskType": A string, either "true-false" or "dictation".
        2.  "answers": An array of strings. For "true-false", this will be ["True", "False", ...]. For "dictation", it will be ["First sentence.", "Second sentence.", ...].
        
        --- INPUTS ---
        Page Context: """
        ${pageText}
        """
        Item Count: ${itemCount}
        Transcript: """
        ${transcriptText}
        """
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let geminiText = response.text();
        console.log("[analyzeAndAnswerWithGemini] Raw response from Gemini:", geminiText);
        
        geminiText = geminiText.replace(/```json/g, '').replace(/```/g, '').trim();
        const structuredAnswer = JSON.parse(geminiText);

        if (!structuredAnswer.taskType || !Array.isArray(structuredAnswer.answers)) {
            throw new Error("Gemini did not return the expected JSON structure.");
        }
        
        return structuredAnswer; // { taskType: '...', answers: [...] }
    } catch (error) {
        console.error("[analyzeAndAnswerWithGemini] Gemini analysis failed. The raw text (if available) that caused the error is logged above. Error details:", error);
        throw new Error("Failed to get a valid structured response from Gemini.");
    }
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
async function downloadFile(url, localFilePath) {
    const writer = createWriteStream(localFilePath);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
    response.body.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(localFilePath));
        writer.on('error', reject);
    });
}

// --- WebSocket Server Logic ---
wss.on('connection', ws => {
  console.log('Relay client connected.');
  ws.on('close', () => console.log('Relay client disconnected.'));
  ws.on('error', error => console.error('WebSocket Error:', error));

  ws.on('message', async msg => {
    const messageString = msg.toString();
    const { id, url, pageText, itemCount, taskType } = JSON.parse(messageString);
    const jobId = id || uuidv4();

    console.log(`[${jobId}] Job received. Task Type Hint: ${taskType || 'N/A'}`);
    console.log(`[${jobId}] Page Context: ${pageText?.length || 0} chars, ${itemCount || 0} items.`);

    if (!url) {
      console.warn(`[${jobId}] Received message without a URL.`);
      return;
    }

    let localFilePath = '';

    try {
      const fileExtension = path.extname(new URL(url).pathname) || '.mp3';
      localFilePath = path.join("uploads", `${jobId}${fileExtension}`);
      
      console.log(`[${jobId}] Downloading audio file to ${localFilePath}...`);
      await downloadFile(url, localFilePath);
      console.log(`[${jobId}] Download complete.`);
      
      console.log(`[${jobId}] Starting transcription with Whisper...`);
      const whisperResult = transcribe(localFilePath);
      const fullTranscript = whisperResult.transcription.map(s => s.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
      console.log(`[${jobId}] Whisper transcription finished. Length: ${fullTranscript.length}`);

      let answerPayload;

      if (GEMINI_API_KEY && fullTranscript) {
          console.log(`[${jobId}] Sending transcript to Gemini for analysis...`);
           try {
              const { taskType, answers } = await analyzeAndAnswerWithGemini(pageText, itemCount, fullTranscript);
              console.log(`[${jobId}] Gemini analysis complete. Task Type: "${taskType}". Answers: ${answers.length}`);
              answerPayload = { type: 'answer', id: jobId, taskType, answers };
          } catch (geminiError) {
              console.error(`[${jobId}] Gemini analysis failed: ${geminiError.message}`);
              answerPayload = { type: 'gemini_failed', payload: { id: jobId, transcript: { text: fullTranscript }, error: geminiError.message } };
          }
      } else {
           console.warn(`[${jobId}] Skipping Gemini: API key not set or empty transcript.`);
           const answers = whisperResult.transcription.map(segment => segment.text.trim()).filter(Boolean);
           answerPayload = { type: 'answer', id: jobId, taskType: 'dictation', answers, error: 'no-gemini' };
      }
      
      ws.send(JSON.stringify(answerPayload));

    } catch (e) {
      console.error(`[${jobId}] Failed to process message:`, e);
      const errorMessage = JSON.stringify({
        type: 'transcription_failed',
        payload: { id: jobId, error: e.message }
      });
      ws.send(errorMessage);
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
