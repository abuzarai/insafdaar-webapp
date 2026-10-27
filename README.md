# Insafdaar: AI-Powered Legal Case Management System

> **Final Year Project** · Built in collaboration with **Insafdaar**, a Pakistani legal firm.  
> A full-stack platform with Client, Advocate and Admin portals and integrated AI services.

[![License](https://img.shields.io/badge/License-PolyForm_Noncommercial-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://reactjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql&logoColor=white)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docker.com)

Insafdaar helps Pakistani law firms manage client intake, advocate assignment,
contracts and ongoing case work. Legal research, document drafting and optional
voice intake support that workflow alongside documents, meetings and billing.

## Portals

| Role | Main workflows |
|------|----------------|
| Client | Create a case and provide intake/documents; select advocate preferences; track cases, contracts and meetings; view invoices, upload payment proof, leave feedback and use legal chat. |
| Advocate | Review assignments; discuss and prepare cases; check/request documents; draft legal documents and contracts; sign contracts; record hearings, stages and closure; manage a professional profile. |
| Admin | Manage clients and advocate verification; review assignments, contracts and meetings; manage billing and payment verification; monitor notifications and platform performance. |

JWT authentication and role middleware protect application workflows. Case access
and internal drafting context are scoped to the relevant client or assigned advocate.
The legal assistant also supports limited guest queries.

## Case journey

1. A client creates a draft case, supplies intake details and uploads supporting
   documents. With voice intake enabled, the client reviews the proposed details,
   confirms the exact revision and submits them before matching.
2. Advocate matching and client preferences feed assignment review. The assigned
   advocate can accept or reject; rejection returns the case for matching review.
3. Discussion and meeting approval lead into contract preparation, OTP signatures
   and admin approval. Rejected meetings or contracts return for revision.
4. Contract approval activates the case. Advocates then track preparation,
   document requests, hearings, case stages and eventual closure, while clients
   follow progress and related billing.

`CASE_ACTIVE` completes the assignment/contract activation state machine. It does
not mean the legal matter is finished; ongoing case-work tracking continues after
activation.

## Architecture

```text
React SPA (Client / Advocate / Admin)
  |
  +-- HTTP API --> Express application API
  |                 +-- PostgreSQL (business records)
  |                 +-- Uploaded files
  |                 +-- Legal RAG --> Gemini embeddings + Weaviate
  |                 |                  --> Gemini answers and citations
  |                 +-- Drafting --> Gemini generation / regeneration / exports
  |                 |     +-- Express internal API: case/intake/documents,
  |                 |                              save drafts
  |                 +-- Voice Live --> Gemini Live
  |                 +-- SMTP email / Google Calendar and Meet
  |
  +-- Direct WebRTC media/data --------------------> Voice Live peer
      (admission, signaling and control go through Express)
```

Express owns application authorization and durable business data: users, cases,
assignments, contracts, billing, conversations, reviewed intake and saved drafts.
PostgreSQL stores these records; the backend manages uploaded documents, evidence
and payment proofs under `backend/uploads`.

The Python services provide AI processing behind service-authenticated HTTP APIs.
They do not replace Express's role and case-access checks. Drafting callbacks use
an internal shared key and assignment-scoped Express endpoints; frontend nginx
blocks `/internal/` routes from its public proxy.

### AI services

| Service | Purpose and integration |
|---------|-------------------------|
| [Legal RAG](https://github.com/abuzarai/legal-rag-assistant) | Express proxies legal questions to the protected Python API. Gemini embeds the query, Weaviate retrieves CPC/case-law chunks, and Gemini generates an answer with citations. Express persists conversations and guest usage. |
| [Drafting](https://github.com/abuzarai/drafting-assistant) | Advocate preparation and contract actions call the Python service for generation jobs, section regeneration and DOCX/PDF export. It fetches case, submitted intake and document context through Express and saves drafts back to Express's `draft_sessions`. |
| [Voice intake](https://github.com/abuzarai/voice-intake-agent) | A bilingual Urdu/English interview uses Gemini Live through a Python WebRTC peer. Express controls case-scoped admission, signaling, proposal persistence, review, confirmation and submission. |

Drafting uses Gemini with application case/intake/document context. Generation
calls a legal-reference retrieval hook, but that hook is currently a stub returning
no references. There is no operational Drafting-to-Legal-RAG integration yet.

Weaviate stores the legal retrieval corpus separately from PostgreSQL. Corpus
ingestion is a separate operation: starting the services does not populate legal
knowledge. See the [RAG service README](https://github.com/abuzarai/legal-rag-assistant#readme)
and [drafting service README](https://github.com/abuzarai/drafting-assistant#readme)
for their configuration and usage.

### Other integrations

- SMTP email delivers OTPs, notifications and scheduled meeting/hearing reminders.
- Google Calendar integration creates events and Meet links for approved meetings,
  subject to configured service-account access.
- Billing includes vouchers, PDF invoices and uploaded payment proof for admin
  verification. This workflow does not imply automated payment-gateway settlement.
- Backend jobs perform document text extraction with Tesseract.js/pdf-parse and
  scheduled reminders; advocate matching ranks candidates from case details.

### Privacy and voice boundaries

Case documents, intake and legal queries can be sent to the configured AI providers
for processing. Keep provider credentials and internal service keys server-side;
use appropriate consent and access controls for sensitive legal information.

Voice intake is disabled by default. It requires explicit configuration,
HTTPS or localhost microphone access, and separately verified WebRTC media
reachability. The current adapter has no configured STUN/TURN servers. Browser
media/data goes directly to the voice peer; Express and nginx do not tunnel it.

The client deliberately starts the interview with a processing/transcript
disclosure. A model proposal remains unconfirmed until client review and
exact-revision confirmation. Saved transcripts may be partial or differ from
heard audio; owning-client transcript access is limited to 90 days after interview
end. Live session state is ephemeral across process replacement. See the public
[voice architecture](https://github.com/abuzarai/voice-intake-agent/blob/main/docs/architecture.md),
[configuration](https://github.com/abuzarai/voice-intake-agent/blob/main/docs/configuration.md)
and [transcript documentation](https://github.com/abuzarai/voice-intake-agent/blob/main/docs/transcripts.md)
for service-level constraints.

## Tech stack

| Layer | Main components |
|-------|-----------------|
| Frontend | React 18, TypeScript, React Router, Tailwind CSS, Axios, react-i18next |
| Application API | Node.js 18+, Express 5, JWT role middleware, Multer uploads, PDFKit, Nodemailer, node-cron |
| Data | PostgreSQL 15, backend-managed uploaded files, Weaviate legal corpus |
| AI services | Python/FastAPI, Gemini generation and embeddings, Gemini Live/WebRTC |
| Infrastructure | Docker Compose; nginx for frontend serving/proxying; host TLS/reverse proxy infrastructure for deployment |

## Local development

### Prerequisites and repository layout

Install [Docker and Docker Compose](https://docs.docker.com/get-docker/).
Compose builds the AI services from sibling repositories. Use these directory
names, including the underscore in `voice_intake_agent`:

```bash
git clone https://github.com/abuzarai/insafdaar-webapp.git webapp
git clone https://github.com/abuzarai/legal-rag-assistant.git
git clone https://github.com/abuzarai/drafting-assistant.git
git clone https://github.com/abuzarai/voice-intake-agent.git voice_intake_agent
cd webapp
cp .env.example .env
```

### Configure services and data

Edit the root environment file using [.env.example](.env.example) as a template:

- Replace placeholders, match PostgreSQL server/application passwords, and set
  a JWT secret and shared internal API key.
- Supply per-service Gemini credentials and the Weaviate API key. Set a stable,
  nonblank `CLUSTER_HOSTNAME` for Weaviate.
- Set browser-reachable API/CORS origins. Configure SMTP and Google Calendar
  credentials if those integrations are needed.
- Provision `../legal-rag-assistant/service_account.json` for the Compose Drive
  credential mount. Copying the environment template does not create this file.
- Leave reviewed voice intake off unless its provider, consent and media
  prerequisites have been configured and verified.

Before starting application services, provision a compatible PostgreSQL schema
and apply the required reviewed migrations. The repository currently has no
supported one-command local database bootstrap helper. Review the
[schema dump](insafdaar_schema.sql) and [migration files](backend/migrations/)
with your database setup; the baseline alone is not a completeness guarantee,
and fresh-client compatibility of the dump has not been verified.

Compose does not initialize the application schema. The production
[apply-migrations script](scripts/apply-migrations.sh) requires approved release,
lock, backup and maintenance evidence; it is not a local initializer.

### Start the configured stack

Once credentials, schema and required service data are ready:

```bash
docker compose up -d --build
```

This orchestrates seven services: PostgreSQL, backend, frontend, Weaviate,
Legal RAG, drafting and voice. Startup alone does not establish a ready-to-use
application or an ingested legal corpus.

| Local endpoint | Address |
|----------------|---------|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:5000 |
| PostgreSQL | `127.0.0.1:5432` |
| Voice HTTP diagnostics | `127.0.0.1:8002` (not the browser signaling endpoint) |

RAG, drafting and Weaviate are internal services in this Compose configuration.
Host TLS nginx is separate deployment infrastructure, not a Compose service.

For native Node development, use Node.js 18+ and `npm install` / `npm start` in
`backend` and `frontend`. Configure backend environment variables manually with
reachable database and AI service URLs; there is no backend `.env.example`.
The root template uses Docker service hostnames. The frontend has its own
[environment template](frontend/.env.example) for the browser API URL. Native
Node processes do not start PostgreSQL, Weaviate or the Python services.

## Deployment

The platform runs with Docker Compose behind an HTTPS reverse proxy.
Production releases use a manual, owner-approved installation process with
backup and migration checks. Intake and background jobs stay disabled until
post-installation checks are complete.

See the [deployment workflow](.github/workflows/deploy.yml) and
[deployment script](scripts/deploy.sh) for the release controls. Pushes to `main`
do not trigger the candidate workflow.

## License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).
Commercial use requires written permission from the author.
