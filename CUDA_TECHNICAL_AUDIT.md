# Deep Technical Audit: CUDA Implementation and Dependency Chain

**Date:** January 28, 2026  
**Project:** MP3 Grabber & Auto-Transcription System  
**Objective:** Analyze CUDA initialization, NVIDIA library path management, and ctranslate2 execution provider integration

---

## Executive Summary

This audit examines the complete CUDA dependency chain from `npm run setup` to successful GPU transcription. The system uses `faster-whisper` (which depends on `ctranslate2`) with NVIDIA CUDA libraries (`nvidia-cublas` and `nvidia-cudnn`) for GPU acceleration. **Critical finding:** There is a version mismatch between the installation code (CUDA 13) and the commented requirements (CUDA 12), which may explain compatibility issues on systems with CUDA 12 drivers.

---

## 1. Initialization Trace: From Setup to First GPU Transcription

### 1.1 Entry Point: `npm run setup` → `start.js`

**Flow:**
```
npm run setup
  → node start.js
    → checkPrerequisites()
      → detectAndLockPythonPath()
      → installGPUDependencies()
      → configureGPULibraryPaths()
      → getGPUStatus()
```

### 1.2 Detailed Step-by-Step Initialization

#### Step 1: Python Path Resolution (`start.js:81-225`)
- **Function:** `resolvePythonPath()`, `detectAndLockPythonPath()`
- **Process:**
  1. Attempts `python`, `py`, `python3` in order
  2. Uses `sys.executable` to get absolute path (critical for Windows)
  3. Validates path can import `faster_whisper`
  4. Saves resolved path to `config.json` as `PYTHON_PATH`
- **Critical:** Path is locked to prevent Python interpreter mismatch

#### Step 2: GPU Dependency Installation (`start.js:931-962`)
- **Function:** `installGPUDependencies()`
- **Process:**
  1. Checks for NVIDIA GPU via `nvidia-smi`
  2. Installs `nvidia-cublas` (no version constraint - auto-detects CUDA version)
  3. **Installs `nvidia-cudnn-cu13`** (hardcoded CUDA 13)
  4. Calls `configureGPULibraryPaths()` to set PATH

**⚠️ CRITICAL DISCREPANCY:**
- Code installs: `nvidia-cudnn-cu13` (line 947)
- Requirements.txt suggests: `nvidia-cudnn-cu12==9.*` (commented, line 11)
- **Impact:** Systems with CUDA 12 drivers may fail silently or fall back to CPU

#### Step 3: PATH Configuration (`start.js:964-1099`)
- **Function:** `configureGPULibraryPaths()`
- **Windows Process:**
  1. Locates `nvidia.cublas` package using `nvidia.cublas.__path__[0]` (Python 3.13+ namespace package fix)
  2. Locates `nvidia.cudnn` package similarly
  3. Checks for `bin/` directory (Windows DLL location), falls back to `lib/`
  4. Prepends found paths to `process.env.PATH` (semicolon-separated on Windows)
  5. Sets `CUDA_PATH`, `CUDA_HOME`, `CUDNN_PATH` environment variables

**Key Code (Windows):**
```javascript
// Line 999-1006: Find cuBLAS DLL path
const cublasLocation = execSync(`${pythonCmd} -c "import nvidia.cublas; print(nvidia.cublas.__path__[0])"`, ...);
const binPath = path.join(cublasLocation, 'bin');
const libPath = path.join(cublasLocation, 'lib');
cublasPath = existsSync(binPath) ? binPath : (existsSync(libPath) ? libPath : null);

// Line 1057-1061: Inject into PATH
if (process.env.PATH) {
  process.env.PATH = `${pathsToAdd.join(';')};${process.env.PATH}`;
}
```

**Linux Process:**
- Sets `LD_LIBRARY_PATH` instead of PATH
- Uses colon-separated paths

#### Step 4: GPU Status Verification (`start.js:272-495`)
- **Function:** `getGPUStatus()`
- **Process:**
  1. Creates temporary Python script (`temp_gpu_test.py`)
  2. Attempts to load `WhisperModel("tiny", device="cuda", compute_type="float16")`
  3. If successful → GPU available
  4. If fails with CUDA errors → GPU unavailable, suggests library installation
  5. Cleans up temp file

**Test Script Logic:**
```python
# Line 292: Actual GPU test
model = WhisperModel("tiny", device="cuda", compute_type="float16")
# If this succeeds, CUDA libraries are accessible
```

#### Step 5: Transcription Execution (`transcribe.py:13-84`)
- **Function:** `transcribe_audio()`
- **Process:**
  1. Checks GPU availability via `check_gpu_availability()` (line 159)
  2. If GPU available: `device="cuda"`, `compute_type="float16"`, `model_size="medium"`
  3. If GPU unavailable: `device="cpu"`, `compute_type="float32"`, `model_size="base"`
  4. Loads model: `WhisperModel(model_size, device=device, compute_type=compute_type)`
  5. Transcribes audio file

---

## 2. DLL Resolution Logic: How Python Finds NVIDIA Binaries

### 2.1 Windows DLL Loading Mechanism

**Python's DLL Search Order (Windows):**
1. Directory containing the executable (`python.exe`)
2. Current working directory
3. System directories (`C:\Windows\System32`, etc.)
4. **PATH environment variable** ← **This is where we inject**
5. Directories in `PYTHONPATH`

### 2.2 How `faster-whisper` → `ctranslate2` → NVIDIA DLLs

**Dependency Chain:**
```
faster-whisper (Python package)
  └─> ctranslate2 (C++ library, Python bindings)
      └─> Loads DLLs at runtime:
          ├─> cublas64_12.dll (or cublas64_11.dll, etc.)
          └─> cudnn64_9.dll (or cudnn64_8.dll, etc.)
```

**ctranslate2 Loading Process:**
1. `ctranslate2` compiled with CUDA support checks for DLLs
2. Searches PATH (where we inject `nvidia-cublas/bin` and `nvidia-cudnn/bin`)
3. Loads DLLs via Windows `LoadLibrary()` API
4. If DLLs not found → falls back to CPU or raises error

### 2.3 Path Injection Timing

**Critical Timing Issue:**
- PATH is set in `start.js` process (`process.env.PATH`)
- When spawning Python subprocess (line 1436), environment is inherited:
  ```javascript
  const pythonProcess = spawn(pythonExe, [PYTHON_SCRIPT, filePath], {
    env: process.env  // ← Inherits PATH with GPU library paths
  });
  ```
- **However:** If `relay.js` starts independently, it must also configure paths (line 669-746)

**Relay.js PATH Configuration:**
- Runs on startup (line 669)
- Uses same logic as `start.js` but executes immediately
- May fail silently if libraries not installed

### 2.4 Namespace Package Handling (Python 3.13+)

**Issue:** Python 3.13+ changed namespace package behavior
- Old: `nvidia.cublas.__file__` gave path
- New: `nvidia.cublas.__file__` is `None`
- **Fix:** Use `nvidia.cublas.__path__[0]` (line 999, 1020)

**Code Pattern:**
```python
# Works on Python 3.13+
import nvidia.cublas
print(nvidia.cublas.__path__[0])  # Returns: C:\...\site-packages\nvidia\cublas
```

---

## 3. Model Loading: faster_whisper.WhisperModel Interface

### 3.1 Device Parameter Validation

**Code:** `transcribe.py:29`
```python
model = WhisperModel(model_size, device=device, compute_type=compute_type)
```

**Device Options:**
- `device="cuda"` → Attempts GPU acceleration
- `device="cpu"` → CPU-only processing

**Validation Process (inside faster-whisper):**
1. Checks if `device="cuda"` is requested
2. Attempts to import/load CUDA libraries via ctranslate2
3. If CUDA libraries unavailable → **silent fallback to CPU** (unless error is raised)
4. If CUDA libraries available but GPU not found → raises error

### 3.2 Compute Type Selection

**Current Implementation:**
- **GPU:** `compute_type="float16"` (line 20, 92)
- **CPU:** `compute_type="float32"` (line 20)

**Available Compute Types:**
- `float16` - Half precision (GPU only, fastest)
- `float32` - Full precision (CPU/GPU, slower but more accurate)
- `int8_float16` - Quantized (GPU only, memory-efficient)
- `int8` - Quantized (CPU/GPU, lowest memory)

**Why `float16` for GPU:**
- 2x faster than `float32` on modern GPUs
- Minimal accuracy loss for Whisper models
- Better memory efficiency

### 3.3 Error Handling and Fallback

**Current Fallback Logic (`transcribe.py:163-167`):**
```python
if gpu_available:
    result = transcribe_audio(audio_file, model_size="medium", use_gpu=True)
    if not result["success"] and ("CUDA" in result["error"] or "cudnn" in result["error"].lower() or "cublas" in result["error"].lower()):
        # Fallback to CPU if GPU fails
        result = transcribe_audio(audio_file, model_size="base", use_gpu=False)
```

**Issues:**
1. **Silent fallback:** No user notification when GPU fails
2. **Error detection:** String matching on error messages (brittle)
3. **No retry logic:** Single attempt then fallback

---

## 4. Dependency Tree Analysis

### 4.1 requirements.txt Analysis

**Current State:**
```txt
faster-whisper>=1.0.0      # No upper bound - may break with future versions
yt-dlp>=2023.0.0
numpy>=1.20.0

# Optional GPU Acceleration (NVIDIA only)
# Uncomment if you have an NVIDIA GPU:
# nvidia-cublas-cu12        # ← Commented out, suggests CUDA 12
# nvidia-cudnn-cu12==9.*    # ← Commented out, version pinned
```

**Issues:**
1. **No version pinning for faster-whisper:** `>=1.0.0` allows any future version
2. **Commented dependencies:** Not installed via `pip install -r requirements.txt`
3. **Version mismatch:** Requirements suggest `cu12`, code installs `cu13`

### 4.2 Actual Installation (start.js)

**What Gets Installed:**
```javascript
// Line 945-947
execSync(`${pipCmd} install nvidia-cublas`, { stdio: 'inherit' });
execSync(`${pipCmd} install nvidia-cudnn-cu13`, { stdio: 'inherit' });
```

**Dependency Resolution:**
- `nvidia-cublas` → Auto-detects CUDA version, installs compatible version
- `nvidia-cudnn-cu13` → **Hardcoded CUDA 13**, may fail on CUDA 12 systems

### 4.3 faster-whisper → ctranslate2 Dependency

**faster-whisper Requirements:**
- `ctranslate2>=3.0.0` (implicit, not in requirements.txt)
- `ctranslate2` requires CUDA libraries at runtime (not install time)

**ctranslate2 CUDA Support:**
- Compiled with CUDA support if CUDA toolkit available during build
- Runtime checks for DLLs in PATH
- **No version constraint** in requirements.txt means ctranslate2 version is uncontrolled

### 4.4 Silent Fallback Scenarios

**When GPU Fails Silently:**
1. **DLL not found:** ctranslate2 falls back to CPU, no error raised
2. **Wrong CUDA version:** DLL version mismatch → may work (backward compatible) or fail
3. **faster-whisper update:** New version may require different ctranslate2 → breaks
4. **ctranslate2 update:** New version may require different CUDA version → breaks

**Detection:**
- Current code checks for GPU availability before transcription
- But if GPU check passes and transcription fails, fallback occurs
- **No logging** of why fallback occurred

---

## 5. Failure Points: Brittle Code Sections

### 5.1 Version Mismatch: CUDA 12 vs CUDA 13

**Location:** `start.js:946`
```javascript
execSync(`${pipCmd} install nvidia-cudnn-cu13`, { stdio: 'inherit' });
```

**Risk:**
- System with CUDA 12 driver → `nvidia-cudnn-cu13` may not work
- CUDA 13 DLLs may not load on CUDA 12 driver
- **Why it might still work:** CUDA backward compatibility (CUDA 13 driver can run CUDA 12 code, but not vice versa)

**Fix Needed:**
- Detect CUDA driver version before installing
- Install matching `nvidia-cudnn-cuXX` package
- Or use `nvidia-cudnn` (auto-detects) instead of version-specific

### 5.2 PATH Injection Not Persisted

**Location:** `start.js:1057-1061`, `relay.js:731-735`

**Issue:**
- PATH is set in `process.env.PATH` for current Node.js process
- When Python subprocess spawns, it inherits PATH ✅
- **But:** If user runs Python script directly, PATH not set ❌
- **But:** If system PATH doesn't include GPU libraries, they won't be found ❌

**Risk:**
- User runs `python transcribe.py file.mp3` directly → GPU libraries not found
- System reboot → PATH reset (unless set system-wide)
- Different terminal session → PATH not set

### 5.3 No Version Pinning for faster-whisper

**Location:** `requirements.txt:4`
```txt
faster-whisper>=1.0.0
```

**Risk:**
- Future `faster-whisper` update may break CUDA integration
- New version may require different `ctranslate2` version
- New version may require different CUDA library versions
- **Silent breakage:** Installation succeeds, but GPU fails at runtime

**Example Breakage Scenario:**
1. User runs `pip install --upgrade faster-whisper`
2. New version requires `ctranslate2>=4.0.0`
3. `ctranslate2 4.0.0` requires CUDA 13 (or different DLL names)
4. Current code installs `nvidia-cudnn-cu13` → may work
5. But if system has CUDA 12 → fails

### 5.4 Error Detection via String Matching

**Location:** `transcribe.py:165`, `start.js:312`

**Issue:**
```python
if "CUDA" in result["error"] or "cudnn" in result["error"].lower() or "cublas" in result["error"].lower():
```

**Risk:**
- Error message format changes → detection fails
- False positives: Error contains "CUDA" but isn't CUDA-related
- False negatives: CUDA error doesn't contain expected keywords

**Better Approach:**
- Check exception type (if available)
- Use structured error codes from ctranslate2
- Log full error for debugging

### 5.5 Namespace Package Path Resolution

**Location:** `start.js:999`, `relay.js:679`

**Issue:**
- Python 3.13+ changed namespace package behavior
- Code uses `__path__[0]` (correct for 3.13+)
- **But:** May fail on older Python versions if `__path__` doesn't exist
- **But:** If package structure changes, path resolution breaks

**Risk:**
- Python 3.12 or earlier → may use `__file__` (not in code, but could be issue)
- Package structure change → path resolution fails
- Multiple `nvidia.cublas` installations → may get wrong path

### 5.6 GPU Test May Hang

**Location:** `start.js:292`

**Issue:**
```python
model = WhisperModel("tiny", device="cuda", compute_type="float16")
```

**Risk:**
- If CUDA libraries partially loaded → model load may hang
- No timeout in Python script (timeout only in Node.js execSync)
- If GPU driver crashed → model load hangs indefinitely

**Current Mitigation:**
- Uses `tiny` model (fastest to load)
- Node.js timeout: 120 seconds (line 344)
- But: If hang occurs, user waits 120 seconds

---

## 6. Comparison Hook: Why cu12 Packages Work on cu13 Driver

### 6.1 CUDA Driver Compatibility

**CUDA Compatibility Rules:**
- **Forward compatible:** CUDA 13 driver can run CUDA 12 code ✅
- **Backward compatible:** CUDA 12 driver **cannot** run CUDA 13 code ❌

**Why cu12 Works on cu13 Driver:**
1. System has CUDA 13 driver installed
2. Code installs `nvidia-cudnn-cu12` (if requirements.txt uncommented)
3. CUDA 13 driver loads CUDA 12 DLLs successfully
4. **But:** Performance may be suboptimal (using older library)

**Why cu13 May Not Work on cu12 Driver:**
1. System has CUDA 12 driver installed
2. Code installs `nvidia-cudnn-cu13` (current behavior)
3. CUDA 12 driver **cannot** load CUDA 13 DLLs
4. **Result:** DLL load fails → fallback to CPU or error

### 6.2 Current Code Behavior

**What Happens:**
- Code installs `nvidia-cudnn-cu13` (hardcoded)
- If system has CUDA 13 driver → works ✅
- If system has CUDA 12 driver → **may fail** ❌

**Why It Might Still Work:**
- `nvidia-cublas` auto-detects CUDA version (no hardcoded version)
- `nvidia-cudnn-cu13` may include backward-compatible DLLs
- Or: System actually has CUDA 13 driver (user may not know)

### 6.3 Detection Strategy Needed

**Recommended Fix:**
```javascript
// Detect CUDA driver version
const cudaVersion = execSync('nvidia-smi --query-gpu=driver_version --format=csv,noheader', ...);
// Or check installed CUDA toolkit version
// Then install matching nvidia-cudnn-cuXX
```

**Alternative:**
- Use `nvidia-cudnn` (no version suffix) - auto-detects
- But: May install wrong version if multiple CUDA versions installed

---

## 7. Recommendations

### 7.1 Immediate Fixes

1. **Fix CUDA Version Detection:**
   - Detect CUDA driver version before installing `nvidia-cudnn-cuXX`
   - Or use `nvidia-cudnn` (auto-detects) instead of hardcoded version

2. **Pin faster-whisper Version:**
   - Change `faster-whisper>=1.0.0` to `faster-whisper==1.0.0` (or specific version)
   - Test compatibility before allowing upgrades

3. **Improve Error Detection:**
   - Use exception types instead of string matching
   - Log full error messages for debugging

4. **Add GPU Fallback Logging:**
   - Log when GPU fails and CPU fallback occurs
   - Include reason for fallback in logs

### 7.2 Long-Term Improvements

1. **Persist PATH Configuration:**
   - Add GPU library paths to system PATH (Windows registry)
   - Or create startup script that sets PATH

2. **Version Compatibility Matrix:**
   - Document tested combinations:
     - faster-whisper X.Y.Z + ctranslate2 A.B.C + CUDA N.M
   - Validate new versions before allowing upgrades

3. **GPU Health Checks:**
   - Periodic GPU availability checks
   - Alert if GPU becomes unavailable

4. **Dependency Lock File:**
   - Use `pip freeze > requirements-lock.txt`
   - Install from lock file for reproducible builds

---

## 8. Testing Scenarios

### 8.1 Test Matrix

| CUDA Driver | nvidia-cudnn-cuXX | Expected Result |
|-------------|-------------------|-----------------|
| CUDA 12     | cu12              | ✅ Works        |
| CUDA 12     | cu13              | ❌ Fails        |
| CUDA 13     | cu12              | ✅ Works (backward compatible) |
| CUDA 13     | cu13              | ✅ Works        |

### 8.2 Failure Mode Testing

1. **Missing DLLs:**
   - Uninstall `nvidia-cublas` or `nvidia-cudnn`
   - Verify graceful fallback to CPU

2. **Wrong CUDA Version:**
   - Install `nvidia-cudnn-cu12` on CUDA 13 system
   - Verify still works (backward compatibility)

3. **PATH Not Set:**
   - Run Python script directly (not via Node.js)
   - Verify error message or fallback

4. **faster-whisper Update:**
   - Upgrade `faster-whisper` to latest
   - Verify GPU still works

---

## 9. Conclusion

The CUDA implementation is **functional but brittle**. The main risks are:

1. **Version mismatch:** Hardcoded CUDA 13 installation may fail on CUDA 12 systems
2. **No version pinning:** Future updates may break GPU support
3. **PATH not persisted:** Direct Python execution may fail
4. **Silent fallbacks:** Users may not know GPU isn't being used

**Critical Action Items:**
1. Implement CUDA version detection before installing libraries
2. Pin `faster-whisper` version in requirements.txt
3. Add comprehensive logging for GPU failures
4. Document tested version combinations

**Why Current Code Works (on CUDA 13 systems):**
- CUDA 13 driver can run CUDA 12/13 code (forward compatible)
- PATH injection happens at right time (before Python spawn)
- Error detection catches most CUDA failures
- Fallback to CPU prevents complete failure

**Why It May Break:**
- CUDA 12 systems → `nvidia-cudnn-cu13` won't load
- faster-whisper update → may require different CUDA version
- PATH not set → direct Python execution fails
- Silent fallback → user doesn't know GPU isn't used

---

**End of Audit**
