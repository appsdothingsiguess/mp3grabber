#!/usr/bin/env python3
"""
Production-ready audio transcription script using faster-whisper.

Features:
- File validation and integrity checks
- Explicit audio extraction using ffmpeg
- Robust error handling with fallback mechanisms
- Structured logging for debugging
- Automatic cleanup of temporary files
- GPU/CPU detection with automatic fallback
"""

import sys
import os
import warnings
import json
import time
import logging
import tempfile
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional, Tuple
from faster_whisper import WhisperModel

# Suppress warnings for cleaner output
warnings.filterwarnings("ignore", category=UserWarning)

# ============================================================================
# LOGGING CONFIGURATION
# ============================================================================

def setup_logging() -> logging.Logger:
    """Configure structured logging for the transcription process."""
    logger = logging.getLogger('transcribe')
    logger.setLevel(logging.DEBUG)
    
    # Console handler for structured output
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(logging.DEBUG)
    
    # Format: [LEVEL] message
    formatter = logging.Formatter('[%(levelname)s] %(message)s')
    console_handler.setFormatter(formatter)
    
    logger.addHandler(console_handler)
    return logger

logger = setup_logging()

# ============================================================================
# FILE VALIDATION
# ============================================================================

def validate_input_file(file_path: str) -> Tuple[bool, Optional[str]]:
    """
    Validate input file before processing.
    
    Args:
        file_path: Path to the input file
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    logger.info(f"Validating input file: {file_path}")
    
    # Check if file exists
    if not os.path.exists(file_path):
        return False, f"File not found: {file_path}"
    
    # Check if it's actually a file (not a directory)
    if not os.path.isfile(file_path):
        return False, f"Path is not a file: {file_path}"
    
    # Check file size
    try:
        file_size = os.path.getsize(file_path)
        if file_size == 0:
            return False, "File is empty (0 bytes)"
        
        if file_size < 100:
            return False, f"File too small ({file_size} bytes) - likely corrupted or not a valid media file"
        
        logger.info(f"File size: {file_size:,} bytes ({file_size / (1024*1024):.2f} MB)")
        
    except OSError as e:
        return False, f"Cannot read file size: {e}"
    
    # Check file extension (basic check)
    valid_extensions = {'.mp3', '.mp4', '.wav', '.m4a', '.webm', '.ogg', '.flac', '.aac', '.wma', '.mkv', '.avi'}
    file_ext = os.path.splitext(file_path)[1].lower()
    
    if file_ext not in valid_extensions:
        logger.warning(f"Unusual file extension: {file_ext} (expected audio/video format)")
    
    logger.info("✓ File validation passed")
    return True, None

# ============================================================================
# AUDIO EXTRACTION
# ============================================================================

def check_ffmpeg_available() -> bool:
    """Check if ffmpeg is available in the system."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-version'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
            check=False
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False

def extract_audio_to_wav(input_file: str, output_wav: str) -> Tuple[bool, Optional[str]]:
    """
    Extract audio from video/audio file to WAV format using ffmpeg.
    This provides more stable processing on Windows.
    
    Args:
        input_file: Path to input media file
        output_wav: Path to output WAV file
        
    Returns:
        Tuple of (success, error_message)
    """
    logger.info("Extracting audio to WAV format using ffmpeg...")
    
    if not check_ffmpeg_available():
        logger.warning("ffmpeg not found - skipping explicit audio extraction")
        return False, "ffmpeg not available"
    
    try:
        # Extract audio: convert to 16kHz mono WAV (optimal for Whisper)
        cmd = [
            'ffmpeg',
            '-i', input_file,
            '-ar', '16000',        # 16kHz sample rate
            '-ac', '1',            # Mono
            '-c:a', 'pcm_s16le',   # 16-bit PCM
            '-y',                  # Overwrite output
            output_wav
        ]
        
        logger.debug(f"Running: {' '.join(cmd)}")
        
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=300,  # 5 minute timeout for audio extraction
            check=False
        )
        
        if result.returncode != 0:
            error_output = result.stderr.decode('utf-8', errors='ignore')
            logger.error(f"ffmpeg failed with code {result.returncode}")
            logger.debug(f"ffmpeg stderr: {error_output[:500]}")
            return False, f"Audio extraction failed: {error_output[:200]}"
        
        # Verify output file was created
        if not os.path.exists(output_wav) or os.path.getsize(output_wav) == 0:
            return False, "Audio extraction produced empty or missing file"
        
        logger.info(f"✓ Audio extracted successfully: {os.path.getsize(output_wav):,} bytes")
        return True, None
        
    except subprocess.TimeoutExpired:
        logger.error("Audio extraction timed out (>5 minutes)")
        return False, "Audio extraction timeout"
    except Exception as e:
        logger.error(f"Audio extraction error: {e}")
        return False, str(e)

# ============================================================================
# GPU AVAILABILITY CHECK
# ============================================================================

def check_gpu_availability() -> bool:
    """Check if GPU libraries are available."""
    logger.info("Checking GPU availability...")
    
    # First try torch (most reliable)
    try:
        import torch
        if torch.cuda.is_available():
            device_name = torch.cuda.get_device_name(0)
            logger.info(f"✓ GPU available via torch.cuda: {device_name}")
            return True
        else:
            logger.info("torch imported but CUDA not available")
    except ImportError as e:
        logger.debug(f"torch not available: {e}")
    
    # Then try CUDA libraries
    try:
        import nvidia.cublas
        import nvidia.cudnn
        logger.info("✓ CUDA libraries available")
        return True
    except ImportError as e:
        logger.debug(f"CUDA libraries not available: {e}")
    
    logger.info("GPU not available - will use CPU")
    return False

# ============================================================================
# TRANSCRIPTION
# ============================================================================

def transcribe_audio(audio_file: str, model_size: str = "medium", use_gpu: bool = True) -> Dict:
    """
    Transcribe audio file using faster-whisper with robust error handling.
    
    Args:
        audio_file: Path to audio/video file
        model_size: Whisper model size (tiny, base, small, medium, large)
        use_gpu: Whether to attempt GPU processing
        
    Returns:
        Dictionary with transcription results or error information
    """
    device = "cuda" if use_gpu else "cpu"
    # Use int8 for CPU (memory efficient), float16 for GPU (speed/quality balance)
    compute_type = "float16" if use_gpu else "int8"
    
    logger.info(f"Initializing {device.upper()} processing with {compute_type} precision")
    print(f"STATUS:Initializing {device.upper()} processing...", flush=True)
    
    model = None
    
    try:
        # ===== MODEL LOADING =====
        logger.info(f"Loading Whisper model: {model_size}")
        print(f"STATUS:Loading Whisper model ({model_size})...", flush=True)
        print(f"STATUS:Checking cache (downloading if needed)...", flush=True)
        
        start_time = time.time()
        
        try:
            model = WhisperModel(model_size, device=device, compute_type=compute_type)
            load_time = time.time() - start_time
            
            # Determine if it was cached based on load time
            is_cached = load_time < (2.0 if use_gpu else 3.0)
            
            if is_cached:
                logger.info(f"Model loaded from cache ({load_time:.1f}s)")
                print(f"STATUS:Model loaded from cache ({load_time:.1f}s)", flush=True)
            else:
                logger.info(f"Model downloaded and loaded ({load_time:.1f}s)")
                print(f"STATUS:Model downloaded and loaded ({load_time:.1f}s)", flush=True)
                
        except Exception as model_error:
            logger.error(f"Failed to load model: {model_error}")
            
            # Check if it's a CUDA-related error
            error_str = str(model_error).lower()
            if any(x in error_str for x in ['cuda', 'cudnn', 'cublas', 'gpu', 'out of memory']):
                if use_gpu:
                    logger.warning("CUDA error detected - GPU may not be properly configured")
                    raise RuntimeError(f"GPU initialization failed: {model_error}")
            
            raise RuntimeError(f"Model loading failed: {model_error}")
        
        # ===== TRANSCRIPTION =====
        logger.info("Starting transcription...")
        print(f"STATUS:Starting transcription...", flush=True)
        
        try:
            segments, info = model.transcribe(
                audio_file,
                beam_size=5,
                vad_filter=True,  # Voice activity detection to skip silence
                vad_parameters=dict(min_silence_duration_ms=500)
            )
            
            logger.info(f"Detected language: {info.language} (confidence: {info.language_probability:.2%})")
            
        except (ValueError, IndexError, TypeError, RuntimeError) as transcribe_error:
            logger.error(f"Transcription failed: {transcribe_error}")
            error_msg = str(transcribe_error)
            
            # Detect common error patterns
            if "tuple index out of range" in error_msg or "list index out of range" in error_msg:
                raise ValueError(
                    "Invalid audio file format. This may be a subtitle/caption file, "
                    "corrupted media, or unsupported format. "
                    f"Original error: {error_msg}"
                )
            
            if "audio" in error_msg.lower() or "decode" in error_msg.lower():
                raise ValueError(f"Audio decoding failed - file may be corrupted: {error_msg}")
            
            raise RuntimeError(f"Transcription error: {error_msg}")
        
        # ===== SEGMENT PROCESSING =====
        logger.info("Processing transcription segments...")
        print(f"STATUS:Processing segments...", flush=True)
        
        transcript_text = ""
        segment_count = 0
        
        try:
            for segment in segments:
                start_time = segment.start
                end_time = segment.end
                
                # Format timestamps as [MM:SS.mmm]
                start_formatted = f"[{int(start_time//60):02d}:{start_time%60:06.3f}]"
                transcript_text += f"{start_formatted} {segment.text.strip()}\n"
                
                segment_count += 1
                if segment_count % 10 == 0:
                    logger.debug(f"Processed {segment_count} segments...")
                    print(f"STATUS:Processed {segment_count} segments...", flush=True)
            
            if segment_count == 0:
                logger.warning("No speech detected in audio file")
                return {
                    "success": True,
                    "transcript": "[No speech detected]",
                    "language": info.language,
                    "language_probability": info.language_probability,
                    "device": device,
                    "compute_type": compute_type,
                    "model_size": model_size,
                    "segment_count": 0
                }
            
            logger.info(f"✓ Transcription complete! ({segment_count} segments)")
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
            
        except Exception as segment_error:
            logger.error(f"Error processing segments: {segment_error}")
            raise RuntimeError(f"Segment processing failed: {segment_error}")
        
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Transcription failed: {error_msg}")
        
        return {
            "success": False,
            "error": error_msg,
            "device": device,
            "compute_type": compute_type,
            "model_size": model_size
        }

# ============================================================================
# SAVE TRANSCRIPTION
# ============================================================================

def save_transcription(
    transcript: str,
    audio_file: str,
    device: str,
    compute_type: str,
    language: str,
    confidence: float,
    model_size: str
) -> Optional[str]:
    """
    Save transcription to transcriptions folder with UTF-8 encoding.
    
    Args:
        transcript: Transcribed text
        audio_file: Original audio file path
        device: Device used (CPU/CUDA)
        compute_type: Compute precision used
        language: Detected language
        confidence: Language detection confidence
        model_size: Whisper model size used
        
    Returns:
        Path to saved file, or None if failed
    """
    try:
        logger.info("Saving transcription to file...")
        
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
        
        # Write to file with explicit UTF-8 encoding (prevents Windows charmap errors)
        try:
            with open(output_file, 'w', encoding='utf-8', errors='replace') as f:
                f.write(header)
                f.write(transcript)
            
            logger.info(f"✓ Transcription saved to: {output_file}")
            return output_file
            
        except UnicodeEncodeError as ue:
            logger.error(f"Unicode encoding error: {ue}")
            # Fallback: write with ASCII encoding and replace non-ASCII characters
            with open(output_file, 'w', encoding='ascii', errors='replace') as f:
                f.write(header)
                f.write(transcript)
            logger.warning(f"Saved with ASCII encoding (some characters may be replaced)")
            return output_file
            
    except Exception as e:
        logger.error(f"Failed to save transcription: {e}")
        return None

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

def main():
    """Main entry point with comprehensive error handling and cleanup."""
    
    # Temporary files to clean up
    temp_wav_file = None
    
    try:
        # ===== ARGUMENT VALIDATION =====
        if len(sys.argv) != 2:
            error_result = {
                "success": False,
                "error": "Usage: python transcribe.py <audio_file>"
            }
            print(json.dumps(error_result))
            logger.error("Invalid arguments")
            sys.exit(1)
        
        audio_file = sys.argv[1]
        logger.info("=" * 70)
        logger.info(f"Starting transcription process for: {audio_file}")
        logger.info("=" * 70)
        
        # ===== FILE VALIDATION =====
        is_valid, validation_error = validate_input_file(audio_file)
        if not is_valid:
            error_result = {
                "success": False,
                "error": f"File validation failed: {validation_error}"
            }
            print(json.dumps(error_result))
            logger.error(f"Validation failed: {validation_error}")
            sys.exit(1)
        
        # ===== AUDIO EXTRACTION (OPTIONAL) =====
        # Try to extract audio explicitly for better stability
        file_to_transcribe = audio_file
        
        try:
            # Create temporary WAV file
            temp_dir = tempfile.gettempdir()
            temp_wav_file = os.path.join(temp_dir, f"whisper_extract_{os.getpid()}.wav")
            
            success, extract_error = extract_audio_to_wav(audio_file, temp_wav_file)
            
            if success:
                logger.info("Using extracted audio for transcription")
                file_to_transcribe = temp_wav_file
            else:
                logger.info(f"Audio extraction skipped: {extract_error}")
                logger.info("Will use original file (Whisper handles extraction internally)")
                file_to_transcribe = audio_file
                temp_wav_file = None  # Don't try to clean up if extraction failed
                
        except Exception as extract_ex:
            logger.warning(f"Audio extraction error (non-fatal): {extract_ex}")
            logger.info("Continuing with original file")
            file_to_transcribe = audio_file
            temp_wav_file = None
        
        # ===== GPU/CPU DETECTION =====
        force_cpu = os.environ.get('FORCE_CPU', '').lower() in ('1', 'true', 'yes')
        
        if force_cpu:
            logger.info("FORCE_CPU environment variable set - using CPU mode")
            print("DEBUG:FORCE_CPU is set, using CPU mode", flush=True)
            use_gpu = False
            model_size = "base"
        else:
            gpu_available = check_gpu_availability()
            use_gpu = gpu_available
            model_size = "medium" if gpu_available else "base"
        
        # ===== TRANSCRIPTION =====
        logger.info(f"Starting transcription with model={model_size}, gpu={use_gpu}")
        
        result = transcribe_audio(file_to_transcribe, model_size=model_size, use_gpu=use_gpu)
        
        # ===== GPU FALLBACK =====
        if not result["success"] and use_gpu:
            error_lower = result.get("error", "").lower()
            is_cuda_error = any(x in error_lower for x in ["cuda", "cudnn", "cublas", "gpu", "out of memory"])
            
            if is_cuda_error:
                logger.warning("GPU error detected - falling back to CPU")
                print("DEBUG:GPU error, retrying with CPU...", flush=True)
                
                result = transcribe_audio(file_to_transcribe, model_size="base", use_gpu=False)
        
        # ===== SAVE TRANSCRIPTION =====
        if result["success"]:
            output_file = save_transcription(
                result["transcript"],
                audio_file,  # Use original filename for output, not temp WAV
                result["device"],
                result["compute_type"],
                result["language"],
                result["language_probability"],
                result["model_size"]
            )
            
            if output_file:
                result["output_file"] = output_file
                logger.info("=" * 70)
                logger.info("✓ TRANSCRIPTION SUCCESSFUL")
                logger.info(f"  Device: {result['device'].upper()}")
                logger.info(f"  Model: {result['model_size']}")
                logger.info(f"  Language: {result['language']} ({result['language_probability']:.1%})")
                logger.info(f"  Segments: {result['segment_count']}")
                logger.info(f"  Output: {output_file}")
                logger.info("=" * 70)
            else:
                logger.warning("Transcription succeeded but file save failed")
        else:
            logger.error("=" * 70)
            logger.error("✗ TRANSCRIPTION FAILED")
            logger.error(f"  Error: {result.get('error', 'Unknown error')}")
            logger.error("=" * 70)
        
        # ===== OUTPUT RESULT =====
        print(json.dumps(result))
        
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        print(json.dumps({"success": False, "error": "Interrupted by user"}))
        sys.exit(130)
        
    except Exception as e:
        logger.exception("Unexpected error in main process")
        print(json.dumps({"success": False, "error": f"Unexpected error: {str(e)}"}))
        sys.exit(1)
        
    finally:
        # ===== CLEANUP TEMPORARY FILES =====
        if temp_wav_file and os.path.exists(temp_wav_file):
            try:
                os.remove(temp_wav_file)
                logger.info(f"✓ Cleaned up temporary file: {temp_wav_file}")
            except Exception as cleanup_error:
                logger.warning(f"Failed to clean up temporary file: {cleanup_error}")

if __name__ == "__main__":
    main()
