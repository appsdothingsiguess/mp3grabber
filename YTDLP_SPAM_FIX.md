# yt-dlp Console Spam Fix

## Problem
yt-dlp was flooding the console with progress messages like:
```
[download] 23.5% of ~12.34MiB at 1.23MiB/s ETA 00:05
[download] 24.1% of ~12.34MiB at 1.24MiB/s ETA 00:05
[download] 24.7% of ~12.34MiB at 1.25MiB/s ETA 00:05
...
```

## Solution
Implemented smart filtering to only show important messages.

## Changes Made

### 1. Stdout Filtering (Lines 698-717)
**Filters out:**
- Progress percentages (`23.5%`)
- Download speeds (`1.23MiB/s`, `KiB/s`)
- ETAs (`ETA 00:05`)

**Shows only:**
- Destination file announcements
- Format merging messages
- File fixing operations
- Already downloaded notifications

### 2. Stderr Filtering (Lines 719-734)
**Before:** Logged everything from stderr
**After:** Only logs WARNING and ERROR messages

### 3. Cleaner Start Message (Line 688)
**Before:**
```
🔧 Running: yt-dlp --cookies /path/to/cookies.txt -f best --postprocessor-args ...
```

**After:**
```
📥 Downloading stream with yt-dlp (output hidden, showing important messages only)...
```

### 4. Silent Cookie Cleanup (Line 737)
Removed success message when cookie file is deleted (only shows errors now).

## Result
Console output is now much cleaner:
```
📥 Downloading stream with yt-dlp (output hidden, showing important messages only)...
   [yt-dlp] [FixupM3u8] Fixing MPEG-TS in MP4 container
✅ yt-dlp download complete
📄 Found downloaded file: abc-123.mp4
🔄 Starting transcription...
```

Instead of hundreds of progress lines.

## Technical Details
- Uses regex pattern matching to filter progress indicators
- Preserves all output in `stdoutData` and `stderrData` for error diagnostics
- Only affects console logging, not actual functionality
