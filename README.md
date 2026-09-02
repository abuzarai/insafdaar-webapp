# Insafdaar: AI-Powered Legal Case Management System

> **Final Year Project** · Built in collaboration with **Insafdaar**, a Pakistani legal firm.  
> A full-stack platform with three user portals (Client, Advocate, Admin) and integrated AI microservices.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://reactjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docker.com)

---

## What Is This?

Insafdaar is a legal case management platform for Pakistani law firms. It digitises the case lifecycle, from client intake to court filing, across three portals:

- **Client Portal**: Submit cases, communicate with advocates, sign contracts, pay invoices
- **Advocate Portal**: Manage cases, prepare filings, draft legal documents, track hearings, close cases
- **Admin Portal**: Assign advocates, approve contracts/meetings, manage billing, monitor performance

The platform runs three AI microservices (voice intake, document drafting, legal RAG). It also uses a state-machine case lifecycle, OTP-signed e-contracts, automated advocate matching, PDF invoices with payment verification, OCR document extraction, Google Calendar/Meet integration, and scheduled email reminders.

---

## User Portals

### Client Portal

| Feature | Description |
|---------|-------------|
| **Case Initiation** | Create a case draft and complete an AI-guided bilingual (Urdu/English) voice interview for structured intake |
| **Document Upload** | Upload supporting documents (CNIC, FIR, etc.) for your case |
| **Advocate Matching** | View AI-ranked advocate candidates based on case details and select your preferred advocate |
| **Case Dashboard** | Track all your cases through every lifecycle stage with progress indicators |
| **E-Contract Signing** | Review, OTP-verify, and digitally sign the advocate-client contract |
| **Billing & Payments** | View invoices and vouchers, upload payment proof for admin verification |
| **Meeting Scheduling** | View approved advocate meetings with auto-generated Google Meet links |
| **Notifications** | Real-time notifications for case updates, billing, contract status |
| **Feedback** | Rate and review your assigned advocate |
| **Legal Assistant** | Full-page RAG chatbot and floating widget for legal queries grounded in Pakistani case law |

### Advocate Portal

| Feature | Description |
|---------|-------------|
| **Case Assignment** | Accept or reject assigned cases with full case details and client information |
| **Case Discussion** | Request meetings with clients (subject to admin approval) with auto-generated Google Meet links |
| **Case Preparation** | Full preparation checklist: verify client documents, request missing docs, upload evidence |
| **AI Document Drafting** | Generate complete legal documents (plaints, written statements, affidavits, appeals) from case data using Gemini AI. Regenerate specific sections, save drafts, export as DOCX/PDF |
| **AI Contract Drafting** | AI-generate advocate-client contracts with similar regenerate/save/export workflow |
| **Hearing Management** | Create hearing records, track attendance, record proceedings, attach evidence and draft documents per hearing |
| **Case Stages Tracking** | Mark case lifecycle stages as completed with progress tracking |
| **Case Closure** | Create and update closure reports for completed cases |
| **E-Contract Signing** | Create contracts with versioning, upload attachments, and sign via OTP |
| **Voucher Access** | View case-linked payment vouchers |
| **Profile Management** | Manage bar details, specialization, experience, work history, education, availability schedule, and verification documents |
| **Notifications** | Receive alerts for case assignments, contract status, meeting approvals |

### Admin Portal

| Feature | Description |
|---------|-------------|
| **Dashboard** | System-wide stats: total users, clients, advocates, active cases |
| **Client Management** | Full CRUD: view, edit, delete clients. Access their dashboard, cases, billing, notifications, feedback |
| **Advocate Management** | Full CRUD with document verification workflow (approve/reject per doc type), approve/unapprove for public listing |
| **Case Assignment** | View assignment queue, review client intake data, run AI advocate matching, assign advocate |
| **Contract Approval** | Review advocate-client contracts, approve (activates case) or reject (sends for revision) |
| **Meeting Approval** | Review and approve/reject meeting requests. Approval creates a Google Calendar event with a Meet link |
| **Billing & Payments** | Create vouchers (standalone or per-case), generate 3-panel PDF invoices with bank details, send to client, view billing history, verify/reject payment proofs, manually override payment status |
| **Performance Monitoring** | Track total requests, average latency, error rates, unique users. Timeseries metrics, slow endpoint identification, system metrics (memory/CPU/uptime), per-endpoint stats, status code distribution, traffic data |
| **Notifications** | Admin alert bell for new registrations, case updates, and system events |

---

## Case Lifecycle

The platform uses a state machine with 13 states, with every transition logged:

```
DRAFT → INTAKE_STARTED → MATCHING_REVIEW → ADVOCATE_ASSIGNED
                                                    │
                                              ┌─────┴─────┐
                                              │           │
                                          ACCEPTED    REJECTED →
                                                       MATCHING_REVIEW
                                              │
                                    MEETING_PENDING_ADMIN
                                              │
                                      ┌───────┴───────┐
                                      │               │
                                MEETING_APPROVED    REJECTED → ACCEPTED
                                      │
                            CONTRACT_PENDING_SIGNATURES
                                      │
                          CONTRACT_PENDING_ADMIN_APPROVAL
                                      │
                              ┌───────┴───────┐
                              │               │
                         CASE_ACTIVE      REJECTED →
                            (terminal)    CONTRACT_PENDING_SIGNATURES
```

---

## AI Microservices

The platform integrates three standalone AI microservices via REST/webhook:

| Service | Tech | Purpose |
|---------|------|---------|
| [legal-rag-assistant](https://github.com/abuzarai/legal-rag-assistant) | FastAPI · Weaviate · Gemini | RAG chatbot over Pakistani case law and CPC sections, returning answers with source citations |
| [drafting-assistant](https://github.com/abuzarai/drafting-assistant) | FastAPI · Gemini API (2.5 Flash) | Generates, iterates, and exports legal documents (plaints, affidavits, written statements, contracts) |
| [voice-intake-agent](https://github.com/abuzarai/voice-intake-agent) | FastAPI · WebSockets · Gemini | Bilingual (Urdu/English) intake interviews via WebSocket: Gemini audio transcription, edge-tts speech playback, Gemini classification of the case summary |

Additional AI/automation built into the main backend:
- **Advocate Matching**: AI-powered candidate ranking based on case details
- **Document OCR**: Background job extracting text from uploaded PNG/JPG/PDF using Tesseract.js and pdf-parse
- **Scheduled Reminders**: Cron jobs for meeting (24h/6h) and court hearing email reminders

---

## System Architecture

```
                         Browser (HTTPS)
                              │
                              ▼
                  host nginx :443 (TLS)
              (HTTP :80 → 301 redirect)
            ┌───────────────┴───────────────┐
            │  / , /api/*                    │  /api/v1/* (REST + WebSocket)
            ▼                                ▼
 ┌────────────────────────┐    ┌─────────────────────────────┐
 │   frontend container    │    │      voice-intake-agent     │
 │  (nginx :80 → host      │    │   (FastAPI + WS · :8000,    │
 │   :3000, SPA + /api    │    │    loopback-published)      │
 │   proxy to backend)     │    └─────────────────────────────┘
 └───────────┬────────────┘
             │  /api/*  (JWT + internal keys)
             ▼
 ┌──────────────────────────────┐
 │        Express Backend       │
 │    (Node.js + JWT · :5000)   │
 │                              │
 │  /api/auth/*        Auth/OTP │
 │  /api/client/*      Client   │
 │  /api/advocate/*    Advocate │
 │  /api/admin/*       Admin    │
 │  /api/legal-assistant → RAG  │
 │  /api/interviews    → Voice  │
 │  /api/drafting      → Draft  │
 │  /api/webhooks      AI hooks │
 └──────┬─────────────┬─────────┘
        │             │
        ▼             ▼
  PostgreSQL     compose network (internal)
  (127.0.0.1)    weaviate · legal-rag · drafting
```

Only 22/80/443 are reachable from the internet; everything else lives on the compose network.

---

## Deployment

Push to `main` in any of the four repos triggers an automated deploy:

1. **Build**: GitHub Actions builds all five service images on a build runner with Docker layer caching.
2. **Ship**: only images whose source changed are transferred to the production host (Oracle Cloud Infrastructure).
3. **Apply**: `docker compose up -d` on the host; pending SQL migrations run automatically; container health checks gate the result.

The pipeline runs on the webapp repo's pushes, on a 15-minute schedule (so AI-microservice pushes reach production quickly), and manually via *Actions → Deploy to Oracle VM → Run workflow*.

---

## Tech Stack

**Backend**
- Node.js 18 + Express 5: REST API server
- PostgreSQL 15 with migrations: primary data store
- JWT authentication with role-based middleware (client / advocate / admin)
- Nodemailer: SMTP email (OTP, notifications, reminders)
- Multer: file uploads (avatars, documents, evidence, payment proofs)
- PDFKit: PDF generation for vouchers/invoices
- Tesseract.js: OCR document text extraction
- node-cron: scheduled jobs (reminders, extraction)
- Google Calendar API: event/Meet link creation
- Google API service-account auth: Calendar/Drive integration

**Frontend**
- React 18 + TypeScript: SPA (Create React App)
- Tailwind CSS 3: utility-first styling
- React Router 7: client-side routing
- Axios: HTTP client with interceptors
- Framer Motion: animations
- Lucide React: icon library
- react-i18next: bilingual (English/Urdu) internationalization
- Service Worker: PWA registration

**AI & Infrastructure**
- Docker Compose: full-stack orchestration (db + backend + frontend + weaviate + the three AI microservices)
- Weaviate: vector store for the legal RAG corpus
- GitHub Actions: automated build/ship/apply pipeline
- Oracle Cloud Infrastructure (OCI): VM hosting
- Nginx: TLS termination and reverse proxying (host + containers)

---

## Local Development

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- Node.js 18+ *(only needed for non-Docker setup)*

### Quick Start with Docker (Recommended)

The compose file builds the AI microservices from sibling clones, so clone all four repos side by side:

```bash
# 1. Clone the four repos into the same parent directory
git clone https://github.com/abuzarai/insafdaar-webapp.git webapp
git clone https://github.com/abuzarai/legal-rag-assistant.git
git clone https://github.com/abuzarai/drafting-assistant.git
git clone https://github.com/abuzarai/voice-intake-agent.git
cd webapp

# 2. Set up environment
cp .env.example .env
# Edit .env with your database password, JWT secret, Gemini keys, etc.

# 3. Start the full stack
docker compose up -d --build

# 4. Initialize the database (first time only)
docker exec -i insafdaar-db psql -U postgres -d insafdaar_db < insafdaar_schema.sql
bash scripts/apply-migrations.sh
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

## Database Schema & Migrations

- Baseline: `insafdaar_schema.sql` (complete schema with tables, indexes, enums)
- Migrations: numbered SQL files in `backend/migrations/` (idempotent, `IF NOT EXISTS`)
- Apply with `scripts/apply-migrations.sh` (docker): tracked per-migration state in a `schema_migrations` bookkeeping table.

Key tables: `users`, `client_profiles`, `advocate_profiles`, `client_cases`, `case_lifecycle_events`, `case_matching_runs`, `case_match_candidates`, `case_documents`, `client_documents`, `case_contracts`, `case_contract_signatures`, `case_intake_sessions`, `case_invoices`, `client_billing`, `client_payment_proofs`, `case_hearings`, `case_hearing_evidence`, `case_hearing_drafts`, `case_closure_reports`, `case_preparation_items`, `case_meetings`, `case_voice_notes`, `case_stage_progress`, `notifications` (per role), `api_logs`, `legal_assistant_conversations`, `legal_assistant_guest_usage`, `document_extraction_jobs`.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` / `DB_PASSWORD` | PostgreSQL password (same value) |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `INTERNAL_API_KEY` | Shared secret for internal microservice auth |
| `SMTP_USER` / `SMTP_PASS` | Gmail SMTP credentials |
| `RAG_GEMINI_API_KEY` / `DRAFTING_GEMINI_API_KEY` / `VOICE_GEMINI_API_KEY` | Gemini keys per AI service (optional in local dev) |
| `WEAVIATE_API_KEY` | Weaviate auth key |
| `VOICE_WEBHOOK_SECRET` | Secret the voice service signs webhooks with |
| `DRIVE_ROOT_FOLDER_ID` | Google Drive corpus folder for legal-rag ingestion |
| `LEGAL_RAG_API_URL` / `DRAFTING_ASSISTANT_URL` | Compose network URLs (`http://legal-rag:8080`, `http://drafting:8080`) |
| `CORS_ALLOWED_ORIGINS` | Allowed browser origins (comma separated) |
| `REACT_APP_API_BASE_URL` / `REACT_APP_VOICE_SERVICE_URL` | Browser-facing API/voice URLs baked into the frontend build |
| `CLUSTER_HOSTNAME` | Weaviate raft identity (keep fixed per environment) |
| `GOOGLE_SERVICE_ACCOUNT_*` | Google Calendar service account credentials |

---

## Repository Structure

```
webapp/
├── backend/
│   ├── controllers/        # Route handler logic
│   ├── routes/             # Express route definitions
│   ├── middleware/         # Auth, role, upload, logging guards
│   ├── migrations/         # SQL migration files
│   ├── jobs/               # Cron job implementations
│   ├── services/           # Business logic (OCR, etc.)
│   ├── utils/              # Lifecycle, payments, contracts, calendar, mailer
│   ├── tests/              # Jest test suite
│   └── server.js           # Entry point
├── frontend/
│   ├── src/
│   │   ├── components/     # Dashboard components per role
│   │   │   ├── ClientDashboard/
│   │   │   ├── AdvocateDashboard/
│   │   │   ├── AdminDashboard/
│   │   │   ├── LegalAssistantChat/
│   │   │   └── VoiceInterview/
│   │   ├── pages/          # Route-level page components
│   │   ├── context/        # i18n, auth state
│   │   └── utils/          # Auth helpers, API config
│   └── Dockerfile
├── scripts/
│   ├── deploy.sh           # Production apply (pull, migrate, compose up)
│   └── apply-migrations.sh # Migration runner (marker-tracked)
├── .github/workflows/      # CI pipeline (build, ship, deploy)
├── insafdaar_schema.sql    # Baseline PostgreSQL schema
├── docker-compose.yml      # Full-stack orchestration
└── .env.example            # Environment template
```

---

## License

Licensed under the [Apache License 2.0](LICENSE).