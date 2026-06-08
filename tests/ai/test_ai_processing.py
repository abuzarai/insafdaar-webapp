from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel


class SpeechPayload(BaseModel):
    audio_base64: str
    language: str = "en"


def build_app(transcriber):
    app = FastAPI()

    @app.post("/ai/process-audio")
    def process_audio(payload: SpeechPayload):
        if not payload.audio_base64.strip():
            raise HTTPException(status_code=400, detail="audio_base64 is required")

        transcript = transcriber(payload.audio_base64, payload.language)
        if not transcript:
            raise HTTPException(status_code=422, detail="Unable to transcribe audio")

        return {
            "transcript": transcript,
            "language": payload.language,
            "confidence": 0.94,
        }

    return app


def test_ai_voice_processing_success():
    def fake_transcriber(audio_base64, language):
        assert language == "ur"
        assert audio_base64.startswith("UklGR")
        return "Mujhe kiraye ke contract ke maslay par madad chahiye"

    client = TestClient(build_app(fake_transcriber))

    response = client.post(
        "/ai/process-audio",
        json={"audio_base64": "UklGRmock-wav-data", "language": "ur"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["transcript"].startswith("Mujhe kiraye")
    assert body["confidence"] >= 0.9


def test_ai_voice_processing_empty_audio():
    client = TestClient(build_app(lambda *_: "unused"))

    response = client.post(
        "/ai/process-audio",
        json={"audio_base64": "   ", "language": "en"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "audio_base64 is required"


def test_ai_voice_processing_unprocessable_audio():
    client = TestClient(build_app(lambda *_: ""))

    response = client.post(
        "/ai/process-audio",
        json={"audio_base64": "invalid-chunk", "language": "en"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Unable to transcribe audio"
