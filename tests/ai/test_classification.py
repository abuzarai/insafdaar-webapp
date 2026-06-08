from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel


class ClassificationPayload(BaseModel):
    case_text: str


def build_app(classifier):
    app = FastAPI()

    @app.post("/ai/classify")
    def classify_case(payload: ClassificationPayload):
        text = payload.case_text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="case_text is required")

        result = classifier(text)
        if not result.get("label"):
            raise HTTPException(status_code=422, detail="classification failed")

        return result

    return app


def test_case_classification_success():
    def fake_classifier(text):
        assert "tenant" in text.lower()
        return {
            "label": "TENANCY_DISPUTE",
            "confidence": 0.91,
            "priority": "MEDIUM",
        }

    client = TestClient(build_app(fake_classifier))

    payload = {
        "case_text": "My tenant has stopped paying rent for 4 months and refuses to vacate.",
    }
    response = client.post("/ai/classify", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["label"] == "TENANCY_DISPUTE"
    assert body["confidence"] > 0.8


def test_case_classification_missing_text():
    client = TestClient(build_app(lambda *_: {"label": "X"}))

    response = client.post("/ai/classify", json={"case_text": "   "})

    assert response.status_code == 400
    assert response.json()["detail"] == "case_text is required"


def test_case_classification_failure_path():
    client = TestClient(build_app(lambda *_: {"label": "", "confidence": 0.0}))

    response = client.post(
        "/ai/classify",
        json={"case_text": "A very noisy and ambiguous report."},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "classification failed"
