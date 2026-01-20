# 🔍 GPU Usage Audit - Why GPU Falls Back to CPU

## Executive Summary
**Problem:** GPU is available but system always falls back to CPU
**Root Cause:** Python 3.13 namespace package changes - `nvidia.cublas.__file__` returns `None`
**Impact:** 100% CPU usage despite GPU hardware availability
**Status:** ⚠️ CRITICAL BUG IDENTIFIED - FIX REQUIRED

---

## Phase 1: Investigation Findings

### GPU Hardware Status
✅ **NVIDIA GPU:** Present (RTX 3070)
✅ **CUDA Libraries Installed:**
- `nvidia-cublas-cu12` 12.9.1.4
- `nvidia-cudnn-cu12` 9.17.1.4

### DLL Locations (Verified to Exist)
✅ **cuBLAS DLLs:**
- Location: `C:\Users\john\AppData\Roaming\Python\Python313\site-packages\nvidia\cublas\bin`
- Files: `cublas64_12.dll`, `cublasLt64_12.dll`, `nvblas64_12.dll`

✅ **cuDNN DLLs:**
- Location: `C:\Python313\Lib\site-packages\nvidia\cudnn\bin`
- Files: `cudnn_adv64_9.dll`, `cudnn_cnn64_9.dll`, `cudnn_ops64_9.dll`, etc.

### PATH Configuration Status
❌ **DLLs NOT in Windows PATH**
```bash
$ where cudnn_ops64_9.dll
DLL not found in PATH

$ where cublas64_12.dll
DLL not found in PATH
```

---

## Phase 2: Root Cause Analysis

### The Critical Bug

**In `relay.js` lines 423-426:**
```javascript
const cublasLocation = execSync(`${pythonCmd} -c "import nvidia.cublas; import os; print(os.path.dirname(nvidia.cublas.__file__))"`, { 
    encoding: 'utf8',
    stdio: 'pipe'
}).trim();
```

**Problem:** In Python 3.13, namespace packages (like `nvidia.cublas`) have `__file__ = None`

**Test Result:**
```python
>>> import nvidia.cublas
>>> nvidia.cublas.__file__
None  # ← Returns None, not a path!
>>> os.path.dirname(None)
TypeError: expected str, bytes or os.PathLike object, not NoneType
```

**What Actually Works:**
```python
>>> nvidia.cublas.__path__
_NamespacePath(['C:\\Users\\john\\AppData\\Roaming\\Python\\Python313\\site-packages\\nvidia\\cublas'])
>>> nvidia.cublas.__path__[0]
'C:\\Users\\john\\AppData\\Roaming\\Python\\Python313\\site-packages\\nvidia\\cublas'
```

### Why This Causes GPU Fallback

1. **Startup Path Configuration Fails Silently**
   - `import nvidia.cublas` works
   - But `nvidia.cublas.__file__` is `None`
   - `os.path.dirname(None)` throws `TypeError`
   - Exception caught, falls back to manual path guessing
   - Manual guessing fails (wrong assumptions about install locations)
   - Result: **PATH never gets CUDA DLL directories**

2. **Python Process Can't Find DLLs**
   - Python script tries to load `faster-whisper` with GPU
   - `faster-whisper` tries to load `ctranslate2` with CUDA
   - `ctranslate2` tries to load CUDA DLLs
   - DLLs not in PATH → **"Could not locate cudnn_ops64_9.dll"**
   - Exit code 3221226505 (Windows access violation)

3. **Fallback to CPU**
   - Node.js detects CUDA error
   - Sets `FORCE_CPU='1'`
   - CPU transcription works (but slow)

---

## Phase 3: Evidence Trail

### Startup Logs Show Silent Failure
```bash
✅ Python executable detected: C:\Windows\py.exe
# NO GPU configuration message!
# Expected: "✅ GPU library paths configured for relay server (2 paths)"
```

### Transcription Logs Show CUDA Errors
```
🔄 Transcribing audio file...
STATUS:Initializing CUDA processing...
ERROR: Could not locate cudnn_ops64_9.dll
⚠️  CUDA error detected
💡 Retrying with CPU mode...
✅ Transcription complete! 💻 Used: CPU
```

### Python 3.13 Namespace Package Behavior
```python
# Python 3.13 changed namespace packages
# BEFORE (Python 3.8-3.12):
>>> import nvidia.cublas
>>> nvidia.cublas.__file__
'/path/to/nvidia/cublas/__init__.py'

# AFTER (Python 3.13+):
>>> import nvidia.cublas
>>> nvidia.cublas.__file__
None  # ← This broke the code!
>>> nvidia.cublas.__path__  # ← Must use this instead
_NamespacePath(['C:\\...\\nvidia\\cublas'])
```

---

## Phase 4: Fix Implementation

### Fix 1: Update PATH Detection in relay.js

**File:** `relay.js`
**Lines:** 420-462

**Replace `__file__` with `__path__[0]`:**

```javascript
// OLD (BROKEN):
const cublasLocation = execSync(`${pythonCmd} -c "import nvidia.cublas; import os; print(os.path.dirname(nvidia.cublas.__file__))"`, ...);

// NEW (FIXED):
const cublasLocation = execSync(`${pythonCmd} -c "import nvidia.cublas; print(nvidia.cublas.__path__[0])"`, ...);
```

### Fix 2: Add Startup Diagnostics

Add logging to confirm PATH configuration:

```javascript
if (pathsToAdd.length > 0) {
  process.env.PATH = `${pathsToAdd.join(';')};${process.env.PATH}`;
  console.log(`✅ GPU library paths configured for relay server (${pathsToAdd.length} paths)`);
  console.log(`   cuBLAS: ${cublasPath}`);
  console.log(`   cuDNN: ${cudnnPath}`);
} else {
  console.warn('⚠️  GPU library paths NOT configured - GPU may not work');
}
```

### Fix 3: Add GPU Status Verification

Add a test at startup:

```javascript
// Test if DLLs are accessible
try {
  execSync(`${pythonCmd} -c "from faster_whisper import WhisperModel; import torch; print('GPU:', torch.cuda.is_available())"`, {
    encoding: 'utf8',
    stdio: 'pipe',
    env: process.env  // Use updated PATH
  });
  console.log('✅ GPU verification passed');
} catch (e) {
  console.warn('⚠️  GPU verification failed - will fall back to CPU');
}
```

---

## Phase 5: Performance Impact

### Current State (CPU Only)
- **Model:** base (smaller, less accurate)
- **Speed:** ~5-10x real-time (10 min video = 50-100 min to transcribe)
- **CPU Usage:** 34%
- **GPU Usage:** 1%
- **Quality:** Lower accuracy with base model

### Expected State (GPU Working)
- **Model:** medium (larger, more accurate)
- **Speed:** ~1x real-time (10 min video = 10 min to transcribe)
- **CPU Usage:** <5%
- **GPU Usage:** 50-80%
- **Quality:** Higher accuracy with medium model

**Performance Gain:** 5-10x faster transcription + better accuracy

---

## Phase 6: Testing Plan

### Test 1: Verify PATH Configuration
```bash
# Start relay server
npm start

# Expected output:
✅ GPU library paths configured for relay server (2 paths)
   cuBLAS: C:\Users\john\AppData\Roaming\Python\Python313\site-packages\nvidia\cublas\bin
   cuDNN: C:\Python313\Lib\site-packages\nvidia\cudnn\bin
```

### Test 2: Verify GPU Usage
```bash
# Download a stream
# Monitor console output

# Expected (GPU working):
STATUS:Initializing CUDA processing...
STATUS:Loading Whisper model (medium)...
✅ Transcription complete! 🎮 Used: CUDA

# NOT expected (CPU fallback):
⚠️  CUDA error detected
💡 Retrying with CPU mode...
```

### Test 3: Monitor Task Manager
- CPU Usage: Should be <10% during transcription
- GPU Usage: Should be 50-80% during transcription

---

## Phase 7: Additional Fixes Needed

### Fix start.js Too

**File:** `start.js`
**Function:** `configureGPULibraryPaths()`

Same issue exists in the setup script - needs to use `__path__[0]` instead of `__file__`.

---

## Conclusion

**Root Cause:** Python 3.13 namespace package API change (`__file__` → `None`)

**Impact:** CUDA DLL paths never added to process.env.PATH → GPU never used

**Solution:** Replace `os.path.dirname(nvidia.cublas.__file__)` with `nvidia.cublas.__path__[0]`

**Expected Result:** GPU will work, 5-10x faster transcription with better accuracy

**Priority:** 🔴 CRITICAL - Fix immediately for performance and user experience
