"""
Demucs Voice Isolation - Modal Serverless Function

Uses the htdemucs_ft model (fine-tuned) for state-of-the-art voice isolation.
Best quality for difficult audio: wind, background music, crowd noise.

Cost: ~$0.01 per minute of audio (T4 GPU)
"""

import modal
import io
import base64

# Create Modal app
app = modal.App("splice-voice-isolation")

# Create image with Demucs and dependencies
demucs_image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg")
    .pip_install(
        "demucs",
        "torch",
        "torchaudio",
        "numpy",
        "soundfile",
        "fastapi[standard]",
    )
)


@app.cls(
    image=demucs_image,
    gpu="T4",  # Cost-effective GPU, ~$0.59/hour
    timeout=600,  # 10 minutes max
    container_idle_timeout=60,  # Keep warm for 1 minute
)
class VoiceIsolator:
    """Voice isolation using Demucs htdemucs_ft model."""

    @modal.enter()
    def load_model(self):
        """Load model on container start (cached across requests)."""
        import torch
        import demucs.pretrained

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Loading htdemucs_ft model on {self.device}...")

        # Load the fine-tuned hybrid model (best quality)
        self.model = demucs.pretrained.get_model("htdemucs_ft")
        self.model.to(self.device)
        self.model.eval()

        print("Model loaded successfully")

    @modal.method()
    def isolate_voice(self, audio_base64: str) -> dict:
        """
        Isolate vocals from audio.

        Args:
            audio_base64: Base64-encoded audio data (WAV or MP3)

        Returns:
            dict with vocals_base64 and accompaniment_base64
        """
        import torch
        import torchaudio
        import soundfile as sf
        import numpy as np
        from demucs.apply import apply_model

        # Decode input audio
        audio_bytes = base64.b64decode(audio_base64)
        audio_buffer = io.BytesIO(audio_bytes)

        # Load audio
        waveform, sample_rate = torchaudio.load(audio_buffer)

        # Resample to model's expected sample rate (44100 Hz)
        if sample_rate != 44100:
            resampler = torchaudio.transforms.Resample(sample_rate, 44100)
            waveform = resampler(waveform)
            sample_rate = 44100

        # Ensure stereo
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        elif waveform.shape[0] > 2:
            waveform = waveform[:2]

        # Add batch dimension and move to device
        waveform = waveform.unsqueeze(0).to(self.device)

        # Apply model
        with torch.no_grad():
            sources = apply_model(
                self.model,
                waveform,
                device=self.device,
                progress=False,
                num_workers=0,
            )

        # sources shape: [batch, num_sources, channels, samples]
        # htdemucs_ft sources: drums, bass, other, vocals
        sources = sources[0]  # Remove batch dimension

        # Extract vocals (index 3) and create accompaniment (everything else)
        vocals = sources[3].cpu().numpy()
        accompaniment = (sources[0] + sources[1] + sources[2]).cpu().numpy()

        # Encode outputs as base64 WAV
        def encode_audio(audio_np: np.ndarray) -> str:
            buffer = io.BytesIO()
            sf.write(buffer, audio_np.T, sample_rate, format="WAV")
            buffer.seek(0)
            return base64.b64encode(buffer.read()).decode("utf-8")

        vocals_base64 = encode_audio(vocals)
        accompaniment_base64 = encode_audio(accompaniment)

        return {
            "vocals_base64": vocals_base64,
            "accompaniment_base64": accompaniment_base64,
            "sample_rate": sample_rate,
            "duration_seconds": vocals.shape[1] / sample_rate,
        }


@app.function(image=demucs_image, gpu="T4", timeout=600)
@modal.web_endpoint(method="POST")
def isolate_voice_endpoint(request: dict) -> dict:
    """
    HTTP endpoint for voice isolation.

    Request body:
        {
            "audio_base64": "base64-encoded audio",
            "return_accompaniment": true/false (optional, default false)
        }

    Response:
        {
            "success": true,
            "vocals_base64": "base64-encoded vocals",
            "accompaniment_base64": "base64-encoded accompaniment" (if requested),
            "duration_seconds": 123.45
        }
    """
    try:
        audio_base64 = request.get("audio_base64")
        return_accompaniment = request.get("return_accompaniment", False)

        if not audio_base64:
            return {"success": False, "error": "audio_base64 is required"}

        # Use the class method for model caching
        isolator = VoiceIsolator()
        result = isolator.isolate_voice.remote(audio_base64)

        response = {
            "success": True,
            "vocals_base64": result["vocals_base64"],
            "duration_seconds": result["duration_seconds"],
        }

        if return_accompaniment:
            response["accompaniment_base64"] = result["accompaniment_base64"]

        return response

    except Exception as e:
        return {"success": False, "error": str(e)}


# For local testing
if __name__ == "__main__":
    # Deploy with: modal deploy voice_isolation.py
    # Test with: modal run voice_isolation.py::test_isolation
    pass


@app.local_entrypoint()
def test_isolation():
    """Test the voice isolation locally."""
    import base64

    # Create a simple test tone
    import numpy as np

    sample_rate = 44100
    duration = 2  # seconds
    t = np.linspace(0, duration, int(sample_rate * duration), False)

    # Generate a simple sine wave (440 Hz)
    tone = np.sin(2 * np.pi * 440 * t) * 0.5
    stereo = np.stack([tone, tone])

    # Encode as WAV
    import io
    import soundfile as sf

    buffer = io.BytesIO()
    sf.write(buffer, stereo.T, sample_rate, format="WAV")
    buffer.seek(0)
    audio_base64 = base64.b64encode(buffer.read()).decode("utf-8")

    # Test the endpoint
    result = isolate_voice_endpoint.remote({"audio_base64": audio_base64})
    print(f"Result: success={result.get('success')}, duration={result.get('duration_seconds')}")
