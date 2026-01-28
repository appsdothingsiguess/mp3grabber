#!/usr/bin/env python3
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
        # Collect segments with timestamps
        transcript_text = ""
        segment_count = 0
        for segment in segments:
            start_time = segment.start
            end_time = segment.end
            # Format timestamps as [MM:SS.mmm]
            start_formatted = f"[{int(start_time//60):02d}:{start_time%60:06.3f}]"
            end_formatted = f"[{int(end_time//60):02d}:{end_time%60:06.3f}]"
            transcript_text += f"{start_formatted} {segment.text.strip()}\n"
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
    """Check if GPU is usable by loading a tiny model on CUDA.
    faster-whisper uses CTranslate2 + nvidia-cublas/cudnn — PyTorch is not required."""
    try:
        print("STATUS:Checking GPU (loading tiny model)...", flush=True)
        from faster_whisper import WhisperModel
        model = WhisperModel("tiny", device="cuda", compute_type="float16")
        return True
    except ImportError:
        return False
    except Exception as e:
        err = str(e).lower()
        if any(x in err for x in ("cuda", "cudnn", "cublas", "dll", "out of memory")):
            return False
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

def write_result_file(result, result_path):
    """Write result JSON to disk for crash recovery."""
    try:
        tmp_path = result_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(json.dumps(result))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, result_path)
    except OSError:
        pass

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
    
    # Write early result for crash recovery
    result_path = audio_file + ".result.json"
    write_result_file(result, result_path)

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

    # Update result file (may now include output_file)
    write_result_file(result, result_path)
    print(json.dumps(result))
