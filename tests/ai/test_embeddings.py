from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel


class EmbeddingPayload(BaseModel):
    text: str


def build_app(embedder):
    app = FastAPI()

    @app.post("/ai/embeddings")
    def create_embeddings(payload: EmbeddingPayload):
        clean_text = payload.text.strip()
        if not clean_text:
            raise HTTPException(status_code=400, detail="text is required")

        vector = embedder(clean_text)
        if not isinstance(vector, list) or len(vector) == 0:
            raise HTTPException(
                status_code=502, detail="embedding provider unavailable"
            )

        return {
            "embedding": vector,
            "dimensions": len(vector),
        }

    return app


def test_generate_embeddings_success():
    def fake_embedder(text):
        assert "contract" in text.lower()
        return [0.12, -0.43, 0.71, 0.09]

    client = TestClient(build_app(fake_embedder))
    response = client.post(
        "/ai/embeddings",
        json={"text": "Breach of contract regarding service delivery timelines"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["dimensions"] == 4
    assert isinstance(body["embedding"], list)


def test_generate_embeddings_empty_input():
    client = TestClient(build_app(lambda *_: [0.1]))
    response = client.post("/ai/embeddings", json={"text": "  "})

    assert response.status_code == 400
    assert response.json()["detail"] == "text is required"


def test_generate_embeddings_provider_failure():
    client = TestClient(build_app(lambda *_: []))
    response = client.post(
        "/ai/embeddings",
        json={"text": "Labor dispute and unpaid wages"},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "embedding provider unavailable"
