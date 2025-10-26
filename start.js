#!/usr/bin/env node

import { createInterface } from 'readline';
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'fs';
import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

// Configuration
const MEDIA_DIR = path.join(__dirname, 'media');
const TRANSCRIPTIONS_DIR = path.join(__dirname, 'transcriptions');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PYTHON_SCRIPT = path.join(__dirname, 'transcribe.py');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// Config management functions
function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const configData = readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(configData);
    }
  } catch (error) {
    log('⚠️  Could not load config file, using defaults', 'yellow');
  }
  return { installCompleted: false, lastInstallDate: null, version: "1.0.0" };
}

function saveConfig(config) {
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    log('⚠️  Could not save config file', 'yellow');
    return false;
  }
}

function shouldSkipInstall(forceReinstall = false) {
  if (forceReinstall) {
    log('🔄 Force reinstall flag detected, skipping install check', 'yellow');
    return false;
  }
  
  const config = loadConfig();
  if (config.installCompleted) {
    log('✅ Previous installation detected, skipping install checks', 'green');
    log(`   Last install: ${config.lastInstallDate || 'Unknown'}`, 'cyan');
    return true;
  }
  
  return false;
}

async function getGPUStatus() {
  try {
    // Write GPU test script to temporary file
    const testScript = `import sys
import os

# Try to create a model with GPU
try:
    from faster_whisper import WhisperModel
    import warnings
    warnings.filterwarnings("ignore")
    
    model = WhisperModel("base", device="cuda", compute_type="float16")
    print("GPU_AVAILABLE:true")
    
except Exception as e:
    error_msg = str(e)
    if "CUDA" in error_msg or "cudnn" in error_msg.lower() or "cublas" in error_msg.lower() or "dll" in error_msg.lower():
        print("GPU_AVAILABLE:false")
        print("GPU_ERROR:" + error_msg)
    else:
        print("GPU_AVAILABLE:unknown")
        print("GPU_ERROR:" + error_msg)`;
    
    // Write script to temporary file
    const fs = await import('fs');
    const path = await import('path');
    const tempScriptPath = path.join(__dirname, 'temp_gpu_test.py');
    fs.writeFileSync(tempScriptPath, testScript);
    
    try {
      const result = execSync(`python "${tempScriptPath}"`, { 
        encoding: 'utf8',
        cwd: __dirname,
        timeout: 30000 // 30 second timeout
      });
      
      const lines = result.trim().split('\n');
      const gpuAvailable = lines.find(line => line.startsWith('GPU_AVAILABLE:'))?.split(':')[1];
      
      if (gpuAvailable === 'true') {
        return { available: true, type: 'GPU (CUDA)', color: 'green' };
      } else if (gpuAvailable === 'false') {
        return { available: false, type: 'CPU', color: 'yellow' };
      } else {
        return { available: false, type: 'CPU (GPU unclear)', color: 'yellow' };
      }
    } finally {
      // Clean up temporary file
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
    
  } catch (error) {
    return { available: false, type: 'CPU (GPU test failed)', color: 'yellow' };
  }
}

// Loading animation function with configurable duration
function showLoadingAnimation(message, duration = 2000) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  
  const interval = setInterval(() => {
    process.stdout.write(`\r${colors.cyan}${frames[i]} ${message}${colors.reset}`);
    i = (i + 1) % frames.length;
  }, 100);
  
  return new Promise((resolve) => {
    setTimeout(() => {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(message.length + 10) + '\r');
      resolve();
    }, duration);
  });
}

async function ensureDirectoriesAndFiles() {
  // Create media directory
  if (!existsSync(MEDIA_DIR)) {
    mkdirSync(MEDIA_DIR, { recursive: true });
    log('✅ Created media directory', 'green');
  } else {
    log('✅ Media directory exists', 'green');
  }

  // Create transcriptions directory
  if (!existsSync(TRANSCRIPTIONS_DIR)) {
    mkdirSync(TRANSCRIPTIONS_DIR, { recursive: true });
    log('✅ Created transcriptions directory', 'green');
  } else {
    log('✅ Transcriptions directory exists', 'green');
  }

  // Create uploads directory
  if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR, { recursive: true });
    log('✅ Created uploads directory', 'green');
  } else {
    log('✅ Uploads directory exists', 'green');
  }

  // Create config.json if it doesn't exist
  if (!existsSync(CONFIG_FILE)) {
    const defaultConfig = {
      installCompleted: false,
      lastInstallDate: null,
      version: "1.0.0"
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    log('✅ Created config.json', 'green');
  } else {
    log('✅ Config file exists', 'green');
  }

  // Create README files for directories if they don't exist
  const mediaReadme = path.join(MEDIA_DIR, 'README.md');
  if (!existsSync(mediaReadme)) {
    const mediaReadmeContent = `# Media Files Directory

Place your audio/video files here for transcription.

## Supported Formats
- Audio: .mp3, .wav, .m4a, .flac, .ogg, .webm
- Video: .mp4, .mkv, .avi (audio automatically extracted)

## Usage
Run \`npm run setup\` and choose option 1 to transcribe files from this directory.

## Tips
- Use shorter files for faster processing
- Higher quality files produce better transcriptions
- GPU acceleration is available for faster processing
`;
    writeFileSync(mediaReadme, mediaReadmeContent);
    log('✅ Created media/README.md', 'green');
  }

  const transcriptionsReadme = path.join(TRANSCRIPTIONS_DIR, 'README.md');
  if (!existsSync(transcriptionsReadme)) {
    const transcriptionsReadmeContent = `# Transcriptions Directory

This directory contains all transcription results.

## File Format
Each transcription file includes:
- Metadata (device, language, confidence)
- Timestamped segments
- Formatted text with intelligent line breaks

## File Naming
- Local files: \`[filename].txt\`
- Extension downloads: \`[uuid].txt\`

## Viewing Transcriptions
Open any .txt file to view the transcription results.
`;
    writeFileSync(transcriptionsReadme, transcriptionsReadmeContent);
    log('✅ Created transcriptions/README.md', 'green');
  }
}

async function checkPrerequisites(forceReinstall = false) {
  // Check if we should skip installation
  if (shouldSkipInstall(forceReinstall)) {
    // Still need to ensure directories and files exist
    await ensureDirectoriesAndFiles();
    // IMPORTANT: Configure GPU paths every time, not just during installation
    await configureGPULibraryPaths(true); // silent mode
    // Return GPU status for skipped installs too
    return { success: true, gpuStatus: await getGPUStatus() };
  }
  
  log('\n🔍 Checking prerequisites...', 'cyan');
  
  // Check Node.js version
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    log(`✅ Node.js: ${nodeVersion}`, 'green');
  } catch (error) {
    log('❌ Node.js not found. Please install Node.js 14 or higher.', 'red');
    return false;
  }

  // Check Python version
  try {
    const pythonVersion = execSync('python --version', { encoding: 'utf8' }).trim();
    log(`✅ Python: ${pythonVersion}`, 'green');
    
    // Check if Python version is 3.9 or higher
    const versionMatch = pythonVersion.match(/Python (\d+)\.(\d+)/);
    if (versionMatch) {
      const major = parseInt(versionMatch[1]);
      const minor = parseInt(versionMatch[2]);
      if (major < 3 || (major === 3 && minor < 9)) {
        log('❌ Python 3.9 or higher is required for faster-whisper', 'red');
        return false;
      }
    }
  } catch (error) {
    log('❌ Python not found. Please install Python 3.9 or higher.', 'red');
    return false;
  }

  // Check if package.json exists
  if (!existsSync(path.join(__dirname, 'package.json'))) {
    log('❌ package.json not found in current directory.', 'red');
    return false;
  }

  // Install Node.js dependencies
  log('📦 Installing Node.js dependencies...', 'cyan');
  try {
    execSync('npm install', { stdio: 'inherit', cwd: __dirname });
    log('✅ Node.js dependencies installed successfully', 'green');
  } catch (error) {
    log('❌ Failed to install Node.js dependencies', 'red');
    return false;
  }

  // Install Python dependencies
  log('📦 Installing Python dependencies (this may take a few minutes)...', 'cyan');
  try {
    // Install faster-whisper with visible progress
    execSync('pip install faster-whisper', { stdio: 'inherit' });
    log('✅ faster-whisper installed successfully', 'green');
    
    // Check for NVIDIA GPU and install GPU dependencies
    await installGPUDependencies();
    
  } catch (error) {
    log('❌ Failed to install Python dependencies', 'red');
    log('   Make sure pip is installed and accessible', 'yellow');
    return false;
  }

  // Create Python transcription script
  await createPythonScript();

  // Verify GPU installation
  await verifyGPUInstallation();

  // Create directories and files if they don't exist
  await ensureDirectoriesAndFiles();

  // Mark installation as complete
  markInstallationComplete();

  // Return GPU status information
  return { success: true, gpuStatus: await getGPUStatus() };
}

function markInstallationComplete() {
  const config = loadConfig();
  config.installCompleted = true;
  config.lastInstallDate = new Date().toISOString();
  config.version = "1.0.0";
  saveConfig(config);
  log('✅ Installation marked as complete', 'green');
}

async function installGPUDependencies() {
  try {
    // Check if NVIDIA GPU is available
    const nvidiaCheck = execSync('nvidia-smi', { encoding: 'utf8', stdio: 'pipe' });
    log('🎮 NVIDIA GPU detected!', 'green');
    
    // Install NVIDIA libraries for GPU support
    log('📦 Installing NVIDIA GPU libraries (this may take a few minutes)...', 'cyan');
    
    try {
      // Install cuBLAS and cuDNN for CUDA 12
      execSync('pip install nvidia-cublas-cu12', { stdio: 'inherit' });
      execSync('pip install nvidia-cudnn-cu12==9.*', { stdio: 'inherit' });
      log('✅ NVIDIA GPU libraries installed successfully', 'green');
      
      // Configure library paths based on platform
      await configureGPULibraryPaths();
      
    } catch (gpuError) {
      log('⚠️  GPU libraries installation failed, falling back to CPU mode', 'yellow');
      log('   GPU acceleration will not be available', 'yellow');
    }
    
  } catch (error) {
    log('💻 No NVIDIA GPU detected, using CPU mode', 'yellow');
    log('   For GPU acceleration, install NVIDIA drivers and CUDA', 'yellow');
  }
}

async function configureGPULibraryPaths(silent = false) {
  try {
    if (process.platform === 'linux') {
      // Linux configuration
      const ldPath = execSync('python3 -c "import os; import nvidia.cublas; import nvidia.cudnn; print(os.path.dirname(nvidia.cublas.__file__) + \":\" + os.path.dirname(nvidia.cudnn.__file__))"', { encoding: 'utf8' }).trim();
      process.env.LD_LIBRARY_PATH = ldPath;
      if (!silent) log('✅ Linux GPU library paths configured', 'green');
    } else if (process.platform === 'win32') {
      // Windows configuration
      if (!silent) log('🔧 Configuring Windows GPU library paths...', 'yellow');
      
      try {
        // Get the Python site-packages directory
        const pythonPath = execSync('python -c "import site; print(site.getusersitepackages())"', { encoding: 'utf8' }).trim();
        
        // Set Windows-specific environment variables
        const cublasPath = path.join(pythonPath, 'nvidia', 'cublas', 'lib');
        const cudnnPath = path.join(pythonPath, 'nvidia', 'cudnn', 'lib');
        
        // Add to PATH for current process
        if (process.env.PATH) {
          process.env.PATH = `${cublasPath};${cudnnPath};${process.env.PATH}`;
        } else {
          process.env.PATH = `${cublasPath};${cudnnPath}`;
        }
        
        // Set CUDA-specific environment variables
        process.env.CUDA_PATH = process.env.CUDA_PATH || 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.0';
        process.env.CUDA_HOME = process.env.CUDA_PATH;
        
        // Set additional Windows-specific environment variables for cuDNN
        process.env.CUDNN_PATH = cudnnPath;
        process.env.CUDNN_LIB_PATH = cudnnPath;
        
        // Add cuDNN bin directory to PATH if it exists
        const cudnnBinPath = path.join(pythonPath, 'nvidia', 'cudnn', 'bin');
        if (existsSync(cudnnBinPath)) {
          process.env.PATH = `${cudnnBinPath};${process.env.PATH}`;
          if (!silent) log(`   cuDNN bin path: ${cudnnBinPath}`, 'cyan');
        }
        
        if (!silent) {
          log('✅ Windows GPU library paths configured', 'green');
          log(`   cuBLAS path: ${cublasPath}`, 'cyan');
          log(`   cuDNN path: ${cudnnPath}`, 'cyan');
        }
        
      } catch (pathError) {
        if (!silent) {
          log('⚠️  Could not configure Windows GPU paths automatically', 'yellow');
          log('   GPU may still work, but manual configuration might be needed', 'yellow');
        }
      }
    }
  } catch (error) {
    if (!silent) {
      log('⚠️  GPU library path configuration failed', 'yellow');
      log('   GPU acceleration may not work properly', 'yellow');
    }
  }
}

async function createPythonScript() {
  const pythonScript = `#!/usr/bin/env python3
import sys
import os
import warnings
import json
import time
from datetime import datetime
from faster_whisper import WhisperModel

# Suppress warnings for cleaner output
warnings.filterwarnings("ignore", category=UserWarning)

def transcribe_audio(audio_file, model_size="medium", use_gpu=True):
    """Transcribe audio file using faster-whisper"""
    try:
        # Determine device and compute type
        device = "cuda" if use_gpu else "cpu"
        # Use float32 for CPU to get better quality (int8 quantizes and reduces accuracy)
        # For GPU, use float16 for speed/quality balance
        compute_type = "float16" if use_gpu else "float32"
        
        print(f"STATUS:Initializing {device.upper()} processing...", flush=True)
        
        # Load model with timing
        print(f"STATUS:Loading Whisper model ({model_size})...", flush=True)
        print(f"STATUS:Checking cache (downloading if needed)...", flush=True)
        
        start_time = time.time()
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        load_time = time.time() - start_time
        
        # Determine if it was cached based on load time
        # Cached models load very quickly (< 2s for GPU, < 3s for CPU)
        if use_gpu:
            is_cached = load_time < 2.0
        else:
            is_cached = load_time < 3.0
        
        if is_cached:
            print(f"STATUS:Model loaded from cache ({load_time:.1f}s)", flush=True)
        else:
            print(f"STATUS:Model downloaded and loaded ({load_time:.1f}s)", flush=True)
        
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
            "model_size": model_size,
            "segment_count": segment_count
        }
        
    except Exception as e:
        error_msg = str(e)
        return {
            "success": False,
            "error": error_msg,
            "device": device,
            "compute_type": compute_type,
            "model_size": model_size
        }

def check_gpu_availability():
    """Check if GPU libraries are available"""
    # Debug: print what we're checking
    print("DEBUG:Checking GPU availability...", flush=True)
    
    # First try torch (most reliable)
    try:
        import torch
        print(f"DEBUG:torch imported, cuda available: {torch.cuda.is_available()}", flush=True)
        if torch.cuda.is_available():
            print("DEBUG:GPU available via torch.cuda", flush=True)
            return True
    except ImportError as e:
        print(f"DEBUG:torch not available: {e}", flush=True)
        pass
    
    # Then try CUDA libraries
    try:
        import nvidia.cublas
        import nvidia.cudnn
        print("DEBUG:CUDA libraries imported successfully", flush=True)
        # If we can import both, assume GPU is available
        # The actual transcription will fallback to CPU if GPU fails
        return True
    except ImportError as e:
        print(f"DEBUG:CUDA libraries not available: {e}", flush=True)
        return False

def save_transcription(transcript, audio_file, device, compute_type, language, confidence, model_size):
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
Model Size: {model_size}
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
    # Use "medium" model for GPU, "base" model for CPU (better performance on CPU)
    if gpu_available:
        result = transcribe_audio(audio_file, model_size="medium", use_gpu=True)
        if not result["success"] and ("CUDA" in result["error"] or "cudnn" in result["error"].lower() or "cublas" in result["error"].lower()):
            # Fallback to CPU if GPU fails
            result = transcribe_audio(audio_file, model_size="base", use_gpu=False)
    else:
        # Use CPU directly with base model
        result = transcribe_audio(audio_file, model_size="base", use_gpu=False)
    
    # Save transcription if successful
    if result["success"]:
        output_file = save_transcription(
            result["transcript"], 
            audio_file, 
            result["device"], 
            result["compute_type"],
            result["language"],
            result["language_probability"],
            result["model_size"]
        )
        if output_file:
            result["output_file"] = output_file
    
    print(json.dumps(result))
`;

  writeFileSync(PYTHON_SCRIPT, pythonScript);
  log('✅ Python transcription script created', 'green');
}

async function verifyGPUInstallation() {
  log('🔍 Verifying GPU installation...', 'cyan');
  
  try {
    // Test GPU availability with Python
    const testScript = `
import sys
import os
try:
    # First check if CUDA libraries can be imported
    try:
        import nvidia.cublas
        import nvidia.cudnn
        print("CUDA_LIBS:available")
    except ImportError as lib_error:
        print("CUDA_LIBS:missing")
        print("CUDA_LIB_ERROR:" + str(lib_error))
    
    # Try to create a model with GPU
    from faster_whisper import WhisperModel
    import warnings
    warnings.filterwarnings("ignore")
    
    model = WhisperModel("base", device="cuda", compute_type="float16")
    print("GPU_AVAILABLE:true")
except Exception as e:
    error_msg = str(e)
    if "CUDA" in error_msg or "cudnn" in error_msg.lower() or "cublas" in error_msg.lower() or "dll" in error_msg.lower():
        print("GPU_AVAILABLE:false")
        print("GPU_ERROR:" + error_msg)
    else:
        print("GPU_AVAILABLE:unknown")
        print("GPU_ERROR:" + error_msg)
`;
    
    const result = execSync(`python -c "${testScript}"`, { 
      encoding: 'utf8',
      cwd: __dirname,
      timeout: 30000 // 30 second timeout
    });
    
    const lines = result.trim().split('\n');
    const gpuAvailable = lines.find(line => line.startsWith('GPU_AVAILABLE:'))?.split(':')[1];
    const gpuError = lines.find(line => line.startsWith('GPU_ERROR:'))?.split(':').slice(1).join(':');
    const cudaLibs = lines.find(line => line.startsWith('CUDA_LIBS:'))?.split(':')[1];
    const cudaLibError = lines.find(line => line.startsWith('CUDA_LIB_ERROR:'))?.split(':').slice(1).join(':');
    
    if (cudaLibs === 'missing') {
      log('⚠️  CUDA libraries not properly accessible', 'yellow');
      if (cudaLibError) {
        log(`   Library Error: ${cudaLibError}`, 'yellow');
      }
    }
    
    if (gpuAvailable === 'true') {
      log('✅ GPU verification successful - CUDA acceleration available', 'green');
    } else if (gpuAvailable === 'false') {
      log('⚠️  GPU verification failed - falling back to CPU mode', 'yellow');
      if (gpuError) {
        log(`   Error: ${gpuError}`, 'yellow');
      }
      log('   This is normal if you don\'t have NVIDIA GPU or CUDA installed', 'yellow');
    } else {
      log('⚠️  GPU verification unclear - will attempt GPU with CPU fallback', 'yellow');
    }
    
  } catch (error) {
    log('⚠️  Could not verify GPU installation - will attempt GPU with CPU fallback', 'yellow');
    log('   This is normal if you don\'t have NVIDIA GPU or CUDA installed', 'yellow');
  }
}

async function transcribeFile() {
  log('\n📁 File Transcription Mode', 'cyan');
  
  // List available audio and video files
  const audioFiles = readdirSync(MEDIA_DIR).filter(file => 
    file.toLowerCase().endsWith('.mp3') || 
    file.toLowerCase().endsWith('.wav') || 
    file.toLowerCase().endsWith('.m4a') ||
    file.toLowerCase().endsWith('.flac') ||
    file.toLowerCase().endsWith('.ogg') ||
    file.toLowerCase().endsWith('.webm') ||
    file.toLowerCase().endsWith('.mp4') ||
    file.toLowerCase().endsWith('.mkv') ||
    file.toLowerCase().endsWith('.avi')
  );

  if (audioFiles.length === 0) {
    log('❌ No audio/video files found in media/ directory', 'red');
    log('   Supported formats: .mp3, .wav, .m4a, .flac, .ogg, .webm, .mp4, .mkv, .avi', 'yellow');
    return;
  }

  log('\nAvailable audio/video files:', 'bright');
  audioFiles.forEach((file, index) => {
    log(`   ${index + 1}. ${file}`, 'blue');
  });

  const choice = await question('\nEnter file number or filename: ');
  
  let selectedFile;
  if (/^\d+$/.test(choice.trim())) {
    const index = parseInt(choice) - 1;
    if (index >= 0 && index < audioFiles.length) {
      selectedFile = audioFiles[index];
    } else {
      log('❌ Invalid file number', 'red');
      return;
    }
  } else {
    if (audioFiles.includes(choice.trim())) {
      selectedFile = choice.trim();
    } else {
      log('❌ File not found', 'red');
      return;
    }
  }

  const filePath = path.join(MEDIA_DIR, selectedFile);
  log(`\n🎵 Transcribing: ${selectedFile}`, 'magenta');
  
  try {
    // Run transcription using Python script with progress tracking
    const startTime = Date.now();
    
    // Create a promise that resolves with the transcription result
    const transcriptionPromise = new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      
      const pythonProcess = spawn('python', [PYTHON_SCRIPT, filePath], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env  // CRITICAL: Pass environment variables including PATH and CUDA paths
      });
      
      pythonProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            if (line.startsWith('STATUS:')) {
              // Handle progress updates
              const status = line.substring(7);
              log(`   ${status}`, 'cyan');
            } else if (line.startsWith('DEBUG:')) {
              // Handle debug messages
              const debug = line.substring(6);
              log(`   [DEBUG] ${debug}`, 'yellow');
            } else if (line.startsWith('{')) {
              // This is the JSON result
              output += line;
            }
          }
        }
      });
      
      pythonProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output.trim());
            resolve(result);
          } catch (e) {
            reject(new Error('Failed to parse transcription result'));
          }
        } else {
          reject(new Error(`Python process exited with code ${code}: ${errorOutput}`));
        }
      });
    });
    
    const transcriptionResult = await transcriptionPromise;
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    if (transcriptionResult.success) {
      log('\n✅ Transcription Complete!', 'green');
      
      log(`\n📊 Transcription Info:`, 'cyan');
      log(`   Language: ${transcriptionResult.language} (${(transcriptionResult.language_probability * 100).toFixed(1)}% confidence)`, 'cyan');
      log(`   Device: ${transcriptionResult.device.toUpperCase()}`, transcriptionResult.device === 'cuda' ? 'green' : 'yellow');
      log(`   Model: ${transcriptionResult.model_size}`, 'cyan');
      log(`   Compute Type: ${transcriptionResult.compute_type}`, 'cyan');
      log(`   Segments Processed: ${transcriptionResult.segment_count || 'N/A'}`, 'cyan');
      log(`   Processing time: ${duration} seconds`, 'cyan');
      
      if (transcriptionResult.output_file) {
        log(`\n📄 Transcription saved to: ${transcriptionResult.output_file}`, 'green');
        log(`   📖 View transcription: file://${transcriptionResult.output_file.replace(/\\/g, '/')}`, 'blue');
      }
      
    } else {
      log('❌ Transcription failed:', 'red');
      log(transcriptionResult.error, 'red');
    }
    
  } catch (error) {
    log('❌ Transcription failed:', 'red');
    log(error.message, 'red');
    log('   Make sure Python and faster-whisper are properly installed', 'yellow');
  }
}

async function startRelayServer() {
  log('\n🌐 Starting Relay Server for Extension Mode', 'cyan');
  log('   The server will run on http://localhost:8787', 'yellow');
  log('   Press Ctrl+C to stop the server', 'yellow');
  
  // Start the relay server
  const relayProcess = spawn('node', ['relay.js'], {
    stdio: 'inherit',
    cwd: __dirname
  });

  relayProcess.on('error', (error) => {
    log('❌ Failed to start relay server:', 'red');
    log(error.message, 'red');
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('\n\n🛑 Shutting down relay server...', 'yellow');
    relayProcess.kill();
    rl.close();
    process.exit(0);
  });

  // Wait for the relay process to exit
  return new Promise((resolve) => {
    relayProcess.on('exit', (code) => {
      log(`\n🛑 Relay server exited with code ${code}`, 'yellow');
      rl.close();
      process.exit(code);
    });
  });
}

async function main() {
  log('🎵 MP3 Grabber & Auto-Transcription System', 'bright');
  log('==========================================', 'bright');

  // Check for force reinstall flag
  const forceReinstall = process.argv.includes('-i') || process.argv.includes('--install');
  
  if (forceReinstall) {
    log('🔄 Force reinstall mode enabled', 'yellow');
  }

  // Check prerequisites
  const prerequisitesResult = await checkPrerequisites(forceReinstall);
  if (!prerequisitesResult.success) {
    log('\n❌ Prerequisites check failed. Please fix the issues above.', 'red');
    rl.close();
    process.exit(1);
  }

  log('\n✅ All prerequisites verified successfully!', 'green');
  
  // Display GPU/CPU status
  const gpuStatus = prerequisitesResult.gpuStatus;
  log(`🎮 Processing Device: ${gpuStatus.type}`, gpuStatus.color);

  // Main menu
  while (true) {
    log('\n' + '='.repeat(50), 'bright');
    log('Choose transcription mode:', 'cyan');
    log('1. Transcribe media file (from media/ folder)', 'blue');
    log('2. Transcribe via browser extension (start relay server)', 'blue');
    log('3. Exit', 'blue');
    
    const choice = await question('\nEnter your choice (1-3): ');
    
    switch (choice.trim()) {
      case '1':
        await transcribeFile();
        break;
      case '2':
        await startRelayServer();
        break;
      case '3':
        log('\n👋 Goodbye!', 'green');
        rl.close();
        process.exit(0);
        break;
      default:
        log('❌ Invalid choice. Please enter 1, 2, or 3.', 'red');
    }
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log('❌ Uncaught Exception:', 'red');
  log(error.message, 'red');
  rl.close();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log('❌ Unhandled Rejection:', 'red');
  log(reason, 'red');
  rl.close();
  process.exit(1);
});

// Start the application
main().catch((error) => {
  log('❌ Application error:', 'red');
  log(error.message, 'red');
  rl.close();
  process.exit(1);
});
