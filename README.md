# Insafdaar — AI-Powered Legal Case Management System

> **Final Year Project** · Built in collaboration with **Insafdaar**, a Pakistani legal firm.  
> A production-deployed, full-stack platform that brings AI to every stage of the legal workflow.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://reactjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docker.com)

---

## 📖 What Is This?

Insafdaar is a full-stack legal case management platform designed for Pakistani law firms. It digitises and automates the entire lifecycle of a legal case — from client onboarding all the way through court filing — and integrates three AI microservices to supercharge advocate productivity.

### Core Features

| Feature | Description |
|---------|-------------|
| 🏛️ **Case Management** | Track cases through every stage: intake → active → filing → appeal |
| 👥 **Client & Advocate Portals** | Separate dashboards for clients and their advocates |
| 📄 **AI Document Drafting** | Generate legal documents (plaints, affidavits, written statements) from case data using Gemini AI |
| 🎙️ **Voice Intake Agent** | Conduct bilingual (Urdu/English) legal interviews via WebSocket audio — auto-transcribed and classified |
| 🔍 **Legal RAG Assistant** | Ask legal questions and get cited answers grounded in Pakistani case law and CPC sections |
| 📅 **Google Calendar Integration** | Schedule hearings with advocate calendars synced through Google Calendar API |
| 📧 **Email Notifications** | Automated SMTP notifications for case updates and hearing reminders |
| 🔐 **JWT Authentication** | Secure role-based access (admin / advocate / client) |
| 🐳 **One-command Docker Setup** | Full stack runs with a single `docker compose up` |

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│              (CRA + Tailwind CSS · Port 80)             │
└────────────────────────┬────────────────────────────────┘
                         │  REST API
┌────────────────────────▼────────────────────────────────┐
│                   Express Backend                        │
│              (Node.js + JWT · Port 5000)                │
│                                                         │
│  /api/public          →  Public endpoints               │
│  /api/legal-assistant →  Proxies to Legal RAG Service   │
│  /api/interviews      →  Proxies to Voice Intake Agent  │
│  /api/drafting        →  Proxies to Drafting Assistant  │
│  /api/webhooks        →  Receives AI microservice hooks │
└──────┬──────────────────┬──────────────────┬────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
  PostgreSQL        Google Cloud         Oracle Cloud
  (Port 5432)         Run (GCP)        Infrastructure
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
    Legal RAG       Drafting       Voice Intake
    Assistant       Assistant        Agent
   (FastAPI)        (FastAPI)      (FastAPI + WS)
```

### AI Microservices (separate repos)

| Service | Tech | Purpose |
|---------|------|---------|
| [legal-rag-assistant](https://github.com/abuzarai/legal-rag-assistant) | FastAPI · Weaviate · Gemini | RAG over Pakistani case law |
| [drafting-assistant](https://github.com/abuzarai/drafting-assistant) | FastAPI · Gemini 2.0 Flash | Legal document generation & export |
| [voice-intake-agent](https://github.com/abuzarai/voice-intake-agent) | FastAPI · WebSockets · GCP STT | Bilingual voice intake interviews |

---

## 🛠️ Tech Stack

**Backend**
- Node.js 18 + Express — REST API
- PostgreSQL 15 — primary data store
- JWT — stateless authentication
- Nodemailer — email notifications
- Google Calendar API — hearing scheduling
- Docker Compose — full local orchestration

**Frontend**
- React 18 (Create React App) + TypeScript
- Tailwind CSS — utility-first styling
- Axios — HTTP client with interceptors

**Infrastructure**
- Oracle Cloud Infrastructure (OCI) — VM hosting
- Google Cloud Run — AI microservices
- GitHub Actions — CI/CD deploy pipeline
- Nginx — reverse proxy for frontend

---

## 🚀 Local Development

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- Node.js 18+ *(only needed for non-Docker setup)*

### Quick Start with Docker (Recommended)

```bash
# 1. Clone the repo
git clone https://github.com/abuzarai/insafdaar-webapp.git
cd insafdaar-webapp

# 2. Set up environment
cp .env.example .env
# Edit .env with your database password, JWT secret, etc.

# 3. Start the full stack
docker compose up -d --build

# 4. Initialize the database (first time only)
docker exec -i insafdaar-db psql -U postgres -d insafdaar_db < insafdaar_schema.sql
./backend/migrations/apply.sh docker
```

The app is now running at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Database**: localhost:5432

### Without Docker

**Backend:**
```bash
cd backend
cp .env.example .env   # Configure DB credentials
npm install
npm start              # Runs on http://localhost:5000
```

**Frontend:**
```bash
cd frontend
cp .env.example .env   # Set REACT_APP_API_BASE_URL=http://localhost:5000
npm install
npm start              # Runs on http://localhost:3000
```

---

## 🗃️ Database Setup

Two-step setup for a fresh database:

```bash
# Step 1 — import baseline schema
docker exec -i insafdaar-db psql -U postgres -d insafdaar_db < insafdaar_schema.sql

# Step 2 — apply incremental migrations
./backend/migrations/apply.sh docker

# Future pulls: only run migrations
./backend/migrations/apply.sh docker
```

Migration files live in `backend/migrations/` and are idempotent (`IF NOT EXISTS`), so rerunning is safe.

---

## 🔑 Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `DB_PASSWORD` | PostgreSQL password |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `INTERNAL_API_KEY` | Shared secret for internal microservice auth |
| `SMTP_USER` / `SMTP_PASS` | Gmail SMTP credentials |
| `LEGAL_RAG_API_URL` | URL of the deployed Legal RAG Cloud Run service |
| `DRAFTING_ASSISTANT_URL` | URL of the deployed Drafting Assistant Cloud Run service |
| `VOICE_SERVICE_URL` | URL of the deployed Voice Intake Agent Cloud Run service |
| `GOOGLE_SERVICE_ACCOUNT_*` | Google Calendar service account credentials |

---

## 📂 Repository Structure

```
webapp/
├── backend/                # Express API
│   ├── migrations/         # Incremental SQL migrations
│   ├── routes/             # API route handlers
│   ├── middleware/         # Auth, error handling
│   └── server.js           # Entry point
├── frontend/               # React app
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page-level components
│   │   └── App.tsx         # Router / entry point
│   └── Dockerfile
├── insafdaar_schema.sql    # Baseline PostgreSQL schema
├── docker-compose.yml      # Full-stack orchestration
└── .env.example            # Environment template
```

---

## 📝 License

Licensed under the [Apache License 2.0](LICENSE).  
