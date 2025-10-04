# Example Audio Files

Place your audio files here for transcription. The system supports:

- **MP3** (`.mp3`) - Most common format
- **WAV** (`.wav`) - Uncompressed audio
- **M4A** (`.m4a`) - Apple audio format
- **FLAC** (`.flac`) - Lossless compression
- **OGG** (`.ogg`) - Open source format
- **WebM** (`.webm`) - Web audio format

## How to Use:

1. Copy your audio files to this directory
2. Run `npm run setup`
3. Select option 1 (Transcribe audio file)
4. Choose your file from the list
5. View the transcription results with GPU/CPU info

## Tips:

- **GPU Acceleration**: NVIDIA GPUs provide 4x faster processing
- **Model Selection**: The system uses the "base" model by default (good balance of speed/accuracy)
- **File Size**: Smaller files process faster
- **Clear Speech**: Better audio quality produces better results
- **Language Detection**: The system automatically detects the language
- **Results**: Transcriptions are saved as `.txt` files alongside your audio files