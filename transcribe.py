#!/usr/bin/env python3
import sys
import os
import warnings
import json
from datetime import datetime
from faster_whisper import WhisperModel

# Suppress warnings for cleaner output
warnings.filterwarnings("ignore", category=UserWarning)

def format_timestamp(seconds):
    """Convert seconds to [MM:SS] format"""
    minutes = int(seconds // 60)
    seconds = int(seconds % 60)
    return f"[{minutes:02d}:{seconds:02d}]"

def add_line_breaks(text, max_length=80):
    """Add intelligent line breaks based on sentence structure and length"""
    if len(text) <= max_length:
        return text
    
    # Split by sentence endings first
    sentences = []
    current_sentence = ""
    
    for char in text:
        current_sentence += char
        if char in '.!?':
            sentences.append(current_sentence.strip())
            current_sentence = ""
    
    # Add remaining text if any
    if current_sentence.strip():
        sentences.append(current_sentence.strip())
    
    # Process each sentence for line breaks
    result_lines = []
    for sentence in sentences:
        if len(sentence) <= max_length:
            result_lines.append(sentence)
        else:
            # Break long sentences at commas, semicolons, or spaces
            words = sentence.split()
            current_line = ""
            
            for word in words:
                if len(current_line + " " + word) <= max_length:
                    if current_line:
                        current_line += " " + word
                    else:
                        current_line = word
                else:
                    if current_line:
                        result_lines.append(current_line)
                    current_line = word
            
            if current_line:
                result_lines.append(current_line)
    
    return '\n'.join(result_lines)

def transcribe_audio(audio_file, model_size="base", use_gpu=True):
    """Transcribe audio file using faster-whisper"""
    try:
        # Determine device and compute type
        device = "cuda" if use_gpu else "cpu"
        compute_type = "float16" if use_gpu else "int8"
        
        print(f"STATUS:Initializing {device.upper()} processing...", flush=True)
        
        # Load model with error handling
        print(f"STATUS:Loading Whisper model ({model_size})...", flush=True)
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        
        print(f"STATUS:Starting transcription...", flush=True)
        # Transcribe
        segments, info = model.transcribe(audio_file, beam_size=5)
        
        print(f"STATUS:Processing segments...", flush=True)
        # Collect segments with timestamps
        formatted_segments = []
        segment_count = 0
        
        for segment in segments:
            # Format timestamp
            start_time = format_timestamp(segment.start)
            end_time = format_timestamp(segment.end)
            
            # Clean the text
            text = segment.text.strip()
            
            # Create formatted segment with timestamp
            formatted_segment = f"{start_time} {text}"
            
            # Add line breaks if needed
            formatted_segment = add_line_breaks(formatted_segment)
            
            formatted_segments.append(formatted_segment)
            segment_count += 1
            
            if segment_count % 10 == 0:  # Progress update every 10 segments
                print(f"STATUS:Processed {segment_count} segments...", flush=True)
        
        # Join segments with proper spacing
        transcript_text = '\n\n'.join(formatted_segments)
        
        print(f"STATUS:Transcription complete!", flush=True)
        
        return {
            "success": True,
            "transcript": transcript_text,
            "language": info.language,
            "language_probability": info.language_probability,
            "device": device,
            "compute_type": compute_type,
            "segment_count": segment_count
        }
        
    except Exception as e:
        error_msg = str(e)
        return {
            "success": False,
            "error": error_msg,
            "device": device,
            "compute_type": compute_type
        }

def check_gpu_availability():
    """Check if GPU is available and working"""
    try:
        import torch
        if torch.cuda.is_available():
            return True
    except ImportError:
        pass
    
    try:
        # Try to import CUDA libraries
        import nvidia.cublas.lib
        import nvidia.cudnn.lib
        return True
    except ImportError:
        return False

def save_transcription(transcript, audio_file, device, compute_type, language, confidence):
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
    if gpu_available:
        result = transcribe_audio(audio_file, use_gpu=True)
        if not result["success"] and ("CUDA" in result["error"] or "cudnn" in result["error"].lower() or "cublas" in result["error"].lower()):
            # Fallback to CPU if GPU fails
            result = transcribe_audio(audio_file, use_gpu=False)
    else:
        # Use CPU directly
        result = transcribe_audio(audio_file, use_gpu=False)
    
    # Save transcription if successful
    if result["success"]:
        output_file = save_transcription(
            result["transcript"], 
            audio_file, 
            result["device"], 
            result["compute_type"],
            result["language"],
            result["language_probability"]
        )
        if output_file:
            result["output_file"] = output_file
    
    print(json.dumps(result))
