# Job Queue Quick Reference Guide

## Quick Start

The queue system is **automatic** - no configuration needed. Just start the server and it works!

```bash
npm start
```

## How It Works

### 🎯 One Job at a Time
- Only **1 download/transcription** processes at a time
- All other jobs wait in queue
- Sequential processing prevents server crashes

### 🔍 Automatic Deduplication
- **Kaltura URLs**: Deduplicated by `entryId` (e.g., `1_abc123xyz`)
- **Regular URLs**: Deduplicated by full URL
- **Duplicates**: Automatically skipped with log message

### 📊 Three-Level Duplicate Check
1. **Currently Processing**: Is this job running right now?
2. **In Queue**: Is this job waiting to be processed?
3. **Completed**: Was this job already done in this session?

## Log Messages Explained

### Queue Operations
```
📥 [QUEUE] Added job abc-123 (entryId: 1_xyz789) - Queue size: 3
└─ Job added to queue, 3 total jobs waiting

🚀 [QUEUE] Processing job abc-123 - Remaining: 2
└─ Job started, 2 jobs still waiting

✅ [QUEUE] Job abc-123 completed
└─ Job finished successfully

❌ [QUEUE] Job abc-123 failed: error message
└─ Job failed but queue continues

📋 [QUEUE] 2 job(s) remaining
└─ Status update between jobs

✨ [QUEUE] All jobs completed
└─ Queue is empty, all done!
```

### Deduplication
```
⏭️  [SKIP] Duplicate stream detected: 1_xyz789
└─ This video is already queued/processing/completed
```

### Download Progress
```
🎬 [DOWNLOAD] Starting download for job abc-123
└─ Download phase started

📥 [DOWNLOAD] Starting yt-dlp download...
└─ yt-dlp process spawned

✅ [DOWNLOAD] Download complete for job abc-123
└─ File downloaded successfully

📄 [DOWNLOAD] File saved: abc-123.mp4
└─ File saved with this name
```

### Transcription Progress
```
🎙️  [TRANSCRIBE] Starting transcription for job abc-123...
└─ Whisper model loading

✅ [TRANSCRIBE] Transcription complete for job abc-123
└─ Transcription finished successfully
```

## Monitor Queue Status

### REST API
```bash
curl http://localhost:8787/queue/status
```

### Response
```json
{
  "queueSize": 3,           // Jobs waiting
  "processing": true,       // Is a job running?
  "currentJob": "abc-123",  // Job ID currently processing
  "completedCount": 5       // Total completed this session
}
```

## Example Scenarios

### Scenario 1: Normal Operation
```
User requests video → Added to queue → Processes → Completes
📥 → 🚀 → 🎬 → 📥 → ✅ → 🎙️ → ✅
```

### Scenario 2: Duplicate Detected
```
User requests same video again → Skipped
⏭️  [SKIP] Duplicate stream detected
```

### Scenario 3: Multiple Jobs
```
Request A → Added (position 1)
Request B → Added (position 2)
Request C → Added (position 3)

Processing: A → B → C (one at a time)
```

### Scenario 4: Kaltura Multi-URL
```
Extension detects:
- Master manifest: /entryId/1_abc123/...master
- 720p variant:    /entryId/1_abc123/...720p
- 480p variant:    /entryId/1_abc123/...480p

Result: Only FIRST one is processed, others skipped (same entryId)
```

## Troubleshooting

### Problem: Queue seems stuck
**Check**: Look for `🚀 [QUEUE] Processing job` in logs
- If present: Job is running, wait for completion
- If absent: Check for errors in logs

### Problem: All jobs getting skipped
**Reason**: Videos already completed in this session
**Solution**: Restart server to clear `completedIds`

### Problem: Want to process same video again
**Solution**: Restart the server - completed IDs are session-based

### Problem: Too many jobs waiting
**Check**: Queue status endpoint to see queue size
**Note**: This is expected behavior - jobs process sequentially

## Technical Details

### EntryId Extraction
```javascript
// Kaltura URL pattern
/entryId/([^\/]+)/

// Examples
/entryId/1_abc123/     → ID: 1_abc123
/entryId/0_xyz789/     → ID: 0_xyz789
https://example.com/   → ID: full URL
```

### File Naming
All downloads forced to: `[jobId].mp4`
- Example: `abc-123-def-456.mp4`
- Prevents naming conflicts
- Easy to track

### yt-dlp Arguments
```bash
--cookies [file]              # Session auth
-f best                       # Best quality
--downloader ffmpeg           # Fix HLS issues ✅
--hls-use-mpegts             # Fix HLS warnings ✅
--postprocessor-args ...     # Fix timestamps
-o [path]                    # Force filename
```

## Best Practices

### ✅ DO
- Let the system handle deduplication automatically
- Monitor queue status during heavy loads
- Check logs for `[SKIP]` messages to see what's being filtered
- Use the status endpoint for monitoring

### ❌ DON'T
- Don't manually try to process same video multiple times
- Don't worry about multiple URLs - system handles it
- Don't restart server unnecessarily (loses completed IDs)
- Don't modify queue system unless you understand it

## Performance

### Expected Behavior
- **1st job**: Starts immediately
- **2nd+ jobs**: Wait in queue
- **Duplicates**: Instant skip (no processing)

### Typical Timeline
```
Download:      30s - 5min (depends on video size)
Transcription: 1min - 10min (depends on length & GPU/CPU)
Total:         2min - 15min per video
```

### Memory Usage
- `completedIds` Set grows with unique videos
- Typical session: < 1000 videos = negligible memory
- Long-running: Consider periodic restarts

## WebSocket Messages

### Client Receives

#### Job Queued
```json
{
  "type": "transcription_queued",
  "payload": {
    "id": "abc-123",
    "queuePosition": 3
  }
}
```

#### Job Skipped (Duplicate)
```json
{
  "type": "transcription_skipped",
  "payload": {
    "id": "abc-123",
    "reason": "Duplicate stream detected",
    "url": "https://..."
  }
}
```

#### Job Complete
```json
{
  "type": "transcription_done",
  "payload": {
    "id": "abc-123",
    "transcript": "...",
    "source": "sniffer"
  }
}
```

#### Job Failed
```json
{
  "type": "transcription_failed",
  "payload": {
    "id": "abc-123",
    "error": "Error message"
  }
}
```

## Summary

✅ **Automatic**: No configuration needed  
✅ **Safe**: One job at a time prevents crashes  
✅ **Smart**: Deduplicates by entryId or URL  
✅ **Reliable**: HLS streams work properly  
✅ **Monitored**: Clear logs and status endpoint  

---

**Need Help?**
- Check logs for `[QUEUE]`, `[SKIP]`, `[DOWNLOAD]`, `[TRANSCRIBE]` messages
- Use status endpoint: `GET /queue/status`
- Look at completed test: `node test_queue.js`
- Read full documentation: `QUEUE_IMPLEMENTATION_SUMMARY.md`
