// Explicit opt-in ONLY. Uses a fresh, marked, socket-only disposable fixture.
// No operational db.js, dotenv, provider client or DATABASE_URL is loaded.
import { jest, describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from "@jest/globals";
import pg from "pg";
import express from "express";
import request from "supertest";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";

const enabled = process.env.REVIEWED_INTAKE_PG_TEST === "disposable-only";
const socket = process.env.REVIEWED_INTAKE_TEST_SOCKET;
const baseline = process.env.REVIEWED_INTAKE_TEST_BASELINE || "reduced";
if (enabled && !["reduced", "repository"].includes(baseline)) throw new Error("Unknown disposable baseline");
const repositoryTest = baseline === "repository" ? test : test.skip;
if (enabled && !/^\/tmp\/insafdaar-reviewed-pg-[A-Za-z0-9]+\/socket$/.test(socket || "")) {
  throw new Error("An explicitly isolated test socket is required; no TCP/URL fallback is allowed");
}
const connection = { host: socket, port: 5432, database: "reviewed_intake_disposable",
  password: "fictional-disposable-only", ssl: false, max: 8, connectionTimeoutMillis: 2000,
  application_name: "reviewed_intake_validation", options: "-c statement_timeout=10000 -c lock_timeout=5000" };
const real = enabled ? new pg.Pool({ ...connection, user: "postgres" }) : null;
// Administrative fixture operations stay separate from actual service queries.
const runtime = enabled && baseline === "repository"
  ? new pg.Pool({ ...connection, user: "reviewed_intake_fixture_runtime" }) : real;
let lockAttempts = [], service, router, server, legacyAfterMigration, databaseIdentity;
let fixtureReady = false, backfilledAdmissions;
const leased = new Set();
const pool = {
  query: (...args) => runtime.query(...args),
  connect: async () => {
    const db = await runtime.connect();
    return { release: () => db.release(), query: (sql, ...args) => {
      const pending = db.query(sql, ...args);
      if (typeof sql === "string" && sql.startsWith("SELECT * FROM public.client_cases")) lockAttempts.push(db.processID);
      return pending;
    } };
  },
};
const live = { admit: jest.fn(), stop: jest.fn(), call: jest.fn() };
if (enabled) {
  jest.unstable_mockModule("../../db.js", () => ({ default: pool }));
  jest.unstable_mockModule("../../services/liveIntakeClient.js", () => ({ liveIntakeClient: live }));
  jest.unstable_mockModule("../../middleware/authMiddleware.js", () => ({ authMiddleware: (req, res, next) => {
    req.user = { id: Number(req.get("x-fixture-user") || 42), role: "client" }; next();
  } }));
  service = await import("../../services/reviewedIntake.service.js");
  ({ default: router } = await import("../../routes/reviewedIntake.routes.js"));
}
const actor = { id: 42, role: "client" };
const sqlFile = name => readFile(new URL(`../../migrations/${name}`, import.meta.url), "utf8");
async function lease() { const db = await real.connect(); leased.add(db); return db; }
function release(db) { leased.delete(db); db.release(); }
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check, message) {
  const end = Date.now() + 3000;
  do { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < end);
  throw new Error(message);
}
async function blocked(pid, blocker) {
  await until(async () => {
    const { rows } = await real.query("SELECT pg_blocking_pids($1) AS ids", [pid]);
    return blocker ? rows[0].ids.includes(blocker) : rows[0].ids.length > 0;
  }, "Expected a real PostgreSQL row-lock wait");
}
const attempt = count => until(() => lockAttempts.length >= count, "Case lock attempt not observed");
function proposal(caseId = 101) {
  return { session_id: `live-${caseId}`, phase: "proposed", proposal: {
    tool_call_id: "fictional-tool", confirmed: false, input_tail_complete: false,
    basis: "unconfirmed proposal from retained Live audio/conversation context",
    facts: Object.fromEntries(service.FACT_FIELDS.map(key => [key, null])),
    analysis: { primary_language: "mixed", legal_domain: "property_law", confidence_score: 0.8,
      key_entities: { parties: [], locations: [], dates: [], amounts: [] }, issue_summary: "Fictional boundary dispute",
      adr_suitable: false, adr_reasoning: "Uncertain", urgency: "medium", urgency_reasoning: "Uncertain" },
  } };
}
async function seed(caseId = 101, userId = 42, admitted = true) {
  await real.query("INSERT INTO public.client_cases (id,user_id,description) VALUES ($1,$2,'Fictional draft issue')", [caseId, userId]);
  if (admitted) {
    await real.query("UPDATE public.client_cases SET intake_protocol='live_v2',intake_version=1,status='INTAKE_STARTED' WHERE id=$1", [caseId]);
    await real.query("INSERT INTO public.case_intake_live_sessions (session_id,case_id,actor_user_id,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '5 minutes')", [`live-${caseId}`, caseId, userId]);
  }
}
const row = async (caseId = 101) => (await real.query("SELECT * FROM public.client_cases WHERE id=$1", [caseId])).rows[0];
const count = async table => Number((await real.query(`SELECT COUNT(*) AS n FROM public.${table}`)).rows[0].n);
const save = (key = "save-one", read = async () => proposal()) => service.saveProposal(actor, 101, key, { sessionId: "live-101", expectedVersion: 1 }, read);
const confirm = async r => {
  // Model a positively acknowledged stop before ordinary review operations.
  await real.query("UPDATE public.case_intake_live_sessions SET expires_at=clock_timestamp() WHERE case_id=101");
  await real.query("UPDATE public.interview_admissions SET active_until=clock_timestamp() WHERE case_id=101");
  return service.confirmRevision(actor, 101, "confirm-one", { revisionId: r.revisionId, expectedVersion: r.caseVersion, acknowledgeReview: true, acknowledgmentVersion: "review-v1" });
};
const submit = c => service.submitIntake(actor, 101, "submit-one", { revisionId: c.revisionId, confirmationId: c.confirmationId, expectedVersion: c.caseVersion });
const post = (body = { expectedVersion: 0, processingConsent: true }) => request(server).post("/cases/101/intake/sessions").set("Idempotency-Key", "admit-one").send(body);
async function transaction(work) {
  const db = await lease();
  try { await db.query("BEGIN"); const value = await work(db); await db.query("COMMIT"); return value; }
  catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { release(db); }
}
const legacyWrites = [
  ["session", "INSERT INTO public.case_intake_sessions (session_id,case_id,user_id) VALUES ('fictional-legacy',101,42)"],
  ["voice note", "INSERT INTO public.case_voice_notes (case_id,notes,audio_url) VALUES (101,'Fictional voice note','https://example.invalid/fictional.wav')"],
];

(enabled ? describe : describe.skip)("reviewed intake: real disposable PostgreSQL", () => {
  beforeAll(async () => {
    databaseIdentity = (await real.query("SELECT current_database() AS db, inet_server_addr() AS address, current_setting('listen_addresses') AS listens, current_setting('server_version') AS version")).rows[0];
    expect(databaseIdentity).toMatchObject({ db: "reviewed_intake_disposable", address: null, listens: "" });
    const guard = (await real.query("SELECT * FROM public.reviewed_intake_test_guard WHERE singleton=true")).rows[0];
    if (guard?.purpose !== "fictional-disposable-only" || guard.migration_sha256 !== null || guard.baseline !== baseline) throw new Error("A fresh, correctly marked disposable fixture is required");
    if (baseline === "repository") {
      const schema = await readFile(new URL("../../../insafdaar_schema.sql", import.meta.url));
      expect(createHash("sha256").update(schema).digest("hex")).toBe(guard.baseline_schema_sha256);
    }
    const migration = await sqlFile("010_reviewed_voice_intake.sql"), db = await real.connect();
    try {
      if (baseline === "reduced") await db.query(await sqlFile("002_case_lifecycle_matching_contracts.sql"));
      await db.query(migration);
      await db.query("INSERT INTO public.client_cases(id,user_id,description) VALUES (901,42,'Fictional admission backfill')");
      await db.query(`INSERT INTO public.case_intake_receipts(case_id,actor_user_id,operation,intent_key,request_hash,response,created_at) VALUES
        (901,42,'admit','backfill-accepted',repeat('a',64),jsonb_build_object('sessionId','fictional-backfill','expiresAt',clock_timestamp()+INTERVAL '1 minute'),clock_timestamp()-INTERVAL '1 minute'),
        (901,42,'admit','backfill-unknown',repeat('b',64),NULL,clock_timestamp()-INTERVAL '1 minute'),
        (901,42,'admit','backfill-rejected',repeat('c',64),'{"rejected":true,"status":429,"code":"LIVE_ADMISSION_RATE_LIMITED"}',clock_timestamp()-INTERVAL '1 minute')`);
      await db.query(await sqlFile("012_interview_admission_limits.sql"));
      backfilledAdmissions = (await db.query("SELECT intent_key,outcome,session_id,active_until>clock_timestamp() AS active FROM public.interview_admissions ORDER BY intent_key")).rows;
      if (baseline === "repository") await db.query("GRANT SELECT,INSERT,UPDATE ON public.interview_admissions,public.interview_admission_policy TO reviewed_intake_fixture_runtime");
      if (baseline === "repository") await db.query(`
        GRANT USAGE ON SCHEMA public TO reviewed_intake_fixture_runtime;
        GRANT SELECT ON public.users,public.case_intake_sessions,public.case_voice_notes TO reviewed_intake_fixture_runtime;
        GRANT SELECT,UPDATE ON public.client_cases TO reviewed_intake_fixture_runtime;
        GRANT SELECT,INSERT ON public.case_intake_revisions,public.case_intake_confirmations,
          public.case_intake_submissions,public.case_intake_receipts TO reviewed_intake_fixture_runtime;
        GRANT UPDATE ON public.case_intake_receipts TO reviewed_intake_fixture_runtime;
        GRANT SELECT,INSERT,UPDATE ON public.case_intake_live_sessions TO reviewed_intake_fixture_runtime;
        GRANT SELECT,INSERT ON public.case_lifecycle_events TO reviewed_intake_fixture_runtime;
        GRANT USAGE ON SEQUENCE public.case_lifecycle_events_id_seq TO reviewed_intake_fixture_runtime;
      `);
      await db.query("UPDATE public.reviewed_intake_test_guard SET migration_sha256=$1 WHERE singleton=true", [createHash("sha256").update(migration).digest("hex")]);
      legacyAfterMigration = (await db.query("SELECT id,status,interview_completed,intake_protocol,intake_version,selected_intake_revision_id,submitted_intake_revision_id FROM public.client_cases WHERE id=900")).rows[0];
      legacyAfterMigration.confirmations = Number((await db.query("SELECT COUNT(*) AS n FROM public.case_intake_confirmations")).rows[0].n);
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
    const app = express(); app.use(express.json()); app.use("/cases/:caseId/intake", router);
    server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
    console.info("Disposable PostgreSQL identity:", { ...databaseIdentity, baseline,
      serviceRole: (await pool.query("SELECT current_user AS name")).rows[0].name });
    fixtureReady = true;
  }, 20000);
  beforeEach(async () => {
    if (!fixtureReady) throw new Error("Disposable fixture setup did not complete");
    await real.query("TRUNCATE public.client_cases RESTART IDENTITY CASCADE");
    await real.query("TRUNCATE public.interview_admissions");
    await real.query("UPDATE public.interview_admission_policy SET paused=false");
    lockAttempts = [];
    live.admit.mockReset().mockResolvedValue({ sessionId: "fictional-admitted", expiresAt: new Date(Date.now() + 240000).toISOString() });
    live.stop.mockReset().mockImplementation(async (_actor,_caseId,id)=>({session_id:id,phase:"partial"}));
    live.call.mockReset().mockRejectedValue(new Error("Provider/media calls prohibited in this fixture"));
    process.env.INTAKE_V2_ENABLED = "true";
  });
  afterEach(async () => {
    // Jest still runs afterEach when beforeAll rejects a target. Never issue
    // cleanup DDL against a fixture that failed identity/baseline validation.
    if (!fixtureReady) return;
    for (const db of [...leased]) { await db.query("ROLLBACK").catch(() => {}); release(db); }
    await real.query("ALTER TABLE public.case_intake_receipts DROP CONSTRAINT IF EXISTS fixture_reject_save");
    await real.query("ALTER TABLE public.case_intake_live_sessions DROP CONSTRAINT IF EXISTS fixture_reject_binding");
    await real.query("ALTER TABLE public.case_lifecycle_events DROP CONSTRAINT IF EXISTS fixture_reject_submission_event");
  });
  afterAll(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (runtime !== real) await runtime.end();
    await real.end();
  });

  test("migration preserves historical data without inventing confirmation", () => {
    expect(legacyAfterMigration).toMatchObject({ id: 900, status: "MATCHING_REVIEW", interview_completed: true,
      intake_protocol: "legacy", intake_version: "0", selected_intake_revision_id: null, submitted_intake_revision_id: null, confirmations: 0 });
  });
  test("actual Save/Confirm/Submit commits one frozen accepted input and event", async () => {
    await seed(); const r = await save(), c = await confirm(r), s = await submit(c);
    expect(s.status).toBe("MATCHING_REVIEW");
    expect(await row()).toMatchObject({ submitted_intake_revision_id: r.revisionId, selected_intake_revision_id: r.revisionId,
      interview_completed: true, status: "MATCHING_REVIEW", intake_version: "4" });
    expect(await count("case_intake_submissions")).toBe(1); expect(await count("case_lifecycle_events")).toBe(1);
    expect((await service.acceptedIntake(pool, 101)).contentHash).toBe(r.contentHash);
    expect(await count("case_intake_sessions")).toBe(0);
  });
  test("lost save/submit replies replay after Stop and later status advancement", async () => {
    await seed(); const read = jest.fn(async () => proposal()), r = await save("save-one", read);
    await real.query("DELETE FROM public.case_intake_live_sessions");
    const c = await confirm(r), s = await submit(c);
    await real.query("UPDATE public.client_cases SET status='ADVOCATE_ASSIGNED',assigned_advocate_id=77 WHERE id=101");
    expect(await save("save-one", read)).toEqual(r); expect(await submit(c)).toEqual(s);
    expect(read).toHaveBeenCalledTimes(1); expect(await count("case_intake_revisions")).toBe(1);
    expect(await count("case_lifecycle_events")).toBe(1);
  });
  test("same key with changed input conflicts without another revision", async () => {
    await seed(); await save();
    await expect(service.saveProposal(actor, 101, "save-one", { sessionId: "different", expectedVersion: 1 }, async () => proposal())).rejects.toMatchObject({ code: "INTENT_CONFLICT" });
    expect(await count("case_intake_revisions")).toBe(1);
  });
  test("simultaneous identical saves really wait on the row lock, then replay", async () => {
    await seed(); const entered = defer(), finish = defer();
    const read = jest.fn(async () => { entered.resolve(); await finish.promise; return proposal(); });
    const a = save("same-key", read); await entered.promise;
    const b = save("same-key", read);
    try { await attempt(2); await blocked(lockAttempts[1], lockAttempts[0]); }
    finally { finish.resolve(); }
    const [left, right] = await Promise.all([a, b]);
    expect(right).toEqual(left); expect(read).toHaveBeenCalledTimes(1);
    expect(await count("case_intake_revisions")).toBe(1); expect(await count("case_intake_receipts")).toBe(1);
  });
  test("simultaneous different save intents allow one winner at the expected version", async () => {
    await seed(); const results = await Promise.allSettled([save("intent-a"), save("intent-b")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected").reason.code).toBe("STALE_CASE_VERSION");
    expect(await count("case_intake_revisions")).toBe(1);
  });
  test("concurrent identical submissions create exactly one database event and receipt", async () => {
    await seed(); const c = await confirm(await save());
    const [a, b] = await Promise.all([submit(c), submit(c)]); expect(a).toEqual(b);
    expect(await count("case_intake_submissions")).toBe(1); expect(await count("case_lifecycle_events")).toBe(1);
    expect(Number((await real.query("SELECT COUNT(*) AS n FROM public.case_intake_receipts WHERE operation='submit'")).rows[0].n)).toBe(1);
  });
  test("Unicode edits retain original source and invalidate the prior confirmation", async () => {
    await seed(); const r = await save(), c = await confirm(r);
    const edited = await service.editRevision(actor, 101, "edit-one", { revisionId: r.revisionId, expectedVersion: c.caseVersion,
      reviewedData: { ...r.reviewedData, issue_summary: "فرضی مقدمے کی درست کردہ تفصیل" } });
    expect((await real.query("SELECT parent_id,source_proposal FROM public.case_intake_revisions WHERE id=$1", [edited.revisionId])).rows[0]).toEqual({ parent_id: r.revisionId, source_proposal: proposal().proposal });
    await expect(service.submitIntake(actor, 101, "stale-confirm", { revisionId: edited.revisionId, confirmationId: c.confirmationId, expectedVersion: edited.caseVersion })).rejects.toMatchObject({ code: "CURRENT_CONFIRMATION_REQUIRED" });
    expect(await service.acceptedIntake(pool, 101)).toBeNull();
  });
  test.each(["case_intake_revisions", "case_intake_confirmations", "case_intake_submissions"])("%s rejects direct UPDATE and DELETE", async table => {
    await seed(); await submit(await confirm(await save()));
    await expect(real.query(`UPDATE public.${table} SET content_hash=$1`, ["b".repeat(64)])).rejects.toMatchObject({ code: "P0001" });
    await expect(real.query(`DELETE FROM public.${table}`)).rejects.toMatchObject({ code: "P0001" });
    expect(await count(table)).toBe(1);
  });
  test("owning-case deletion cascades through parent/child revisions and accepted history", async () => {
    await seed(); const r = await save(), first = await confirm(r);
    const edited = await service.editRevision(actor, 101, "edit-one", { revisionId: r.revisionId, expectedVersion: first.caseVersion,
      reviewedData: { ...r.reviewedData, issue_summary: "Corrected fictional boundary dispute" } });
    const c = await service.confirmRevision(actor, 101, "confirm-edited", { revisionId: edited.revisionId, expectedVersion: edited.caseVersion, acknowledgeReview: true, acknowledgmentVersion: "review-v1" });
    await submit(c); await real.query("DELETE FROM public.client_cases WHERE id=101");
    for (const table of ["case_intake_revisions", "case_intake_confirmations", "case_intake_submissions", "case_intake_receipts", "case_intake_live_sessions", "case_lifecycle_events"]) expect(await count(table)).toBe(0);
    expect(await count("users")).toBe(4);
  });
  test.each(["description='overwrite'", "language='urdu'", "legal_domain='other'", "interview_completed=false", "intake_version=intake_version+1", "submitted_intake_revision_id=NULL", "status='DRAFT'"])("submitted case rejects %s", async mutation => {
    await seed(); await submit(await confirm(await save()));
    await expect(real.query(`UPDATE public.client_cases SET ${mutation} WHERE id=101`)).rejects.toMatchObject({ code: "P0001" });
  });
  test.each(["status='MATCHING_REVIEW'", "status='ADVOCATE_ASSIGNED'", "assigned_advocate_id=77", "interview_completed=true", "intake_protocol='legacy'", "user_id=43", "intake_version=0"])("unsubmitted case rejects %s", async mutation => {
    await seed(); await expect(real.query(`UPDATE public.client_cases SET ${mutation} WHERE id=101`)).rejects.toMatchObject({ code: "P0001" });
  });
  test.each(["INTAKE_STARTED", "MATCHING_REVIEW", "ADVOCATE_ASSIGNED", "CASE_ACTIVE"])("direct INSERT cannot fabricate an already-progressed reviewed case (%s)", async status => {
    await expect(real.query("INSERT INTO public.client_cases (id,user_id,description,intake_protocol,status) VALUES (101,42,'Fictional draft','live_v2',$1)", [status])).rejects.toMatchObject({ code: "P0001", message: "Reviewed case must start as an empty unassigned draft" });
    expect(await count("client_cases")).toBe(0);
  });
  test("a reviewed case can be inserted only as an empty unassigned draft", async () => {
    await real.query("INSERT INTO public.client_cases (id,user_id,description,intake_protocol) VALUES (101,42,'Fictional draft','live_v2')");
    expect(await row()).toMatchObject({ status: "DRAFT", intake_version: "0", interview_completed: false, selected_intake_revision_id: null, submitted_intake_revision_id: null, assigned_advocate_id: null });
  });
  test.each(["interview_completed", "intake_version", "assigned_advocate_id"])("new reviewed draft cannot prepopulate %s", async field => {
    const value = { interview_completed: "true", intake_version: "1", assigned_advocate_id: "77" }[field];
    await expect(real.query(`INSERT INTO public.client_cases (id,user_id,description,intake_protocol,${field}) VALUES (101,42,'Fictional draft','live_v2',${value})`)).rejects.toMatchObject({ code: "P0001", message: "Reviewed case must start as an empty unassigned draft" });
    expect(await count("client_cases")).toBe(0);
  });
  test.each(["selected_intake_revision_id", "submitted_intake_revision_id"])("new reviewed draft cannot prepopulate %s", async field => {
    // An initial case cannot already own history; assert the BEFORE INSERT guard,
    // not the unrelated missing-reference FK error that would otherwise follow.
    await expect(real.query(`INSERT INTO public.client_cases (id,user_id,description,intake_protocol,${field}) VALUES (101,42,'Fictional draft','live_v2',$1)`, [randomUUID()])).rejects.toMatchObject({ code: "P0001", message: "Reviewed case must start as an empty unassigned draft" });
    expect(await count("client_cases")).toBe(0);
  });
  test("cross-case selected revision is rejected by its composite foreign key", async () => {
    await seed(); const r = await save(); await seed(102, 43);
    await expect(real.query("UPDATE public.client_cases SET selected_intake_revision_id=$1,intake_version=intake_version+1 WHERE id=102", [r.revisionId])).rejects.toMatchObject({ code: "23503" });
  });
  test("confirmation cannot bind a different revision hash", async () => {
    await seed(); const r = await save();
    await expect(real.query("INSERT INTO public.case_intake_confirmations (id,case_id,revision_id,actor_user_id,content_hash,case_version,acknowledgment_version) VALUES ($1,101,$2,42,$3,3,'review-v1')", [randomUUID(), r.revisionId, "b".repeat(64)])).rejects.toMatchObject({ code: "23503" });
  });
  test("submission cannot bind another confirmation actor", async () => {
    await seed(); const r = await save(), c = await confirm(r);
    await expect(real.query("INSERT INTO public.case_intake_submissions (case_id,revision_id,confirmation_id,actor_user_id,content_hash) VALUES (101,$1,$2,43,$3)", [r.revisionId, c.confirmationId, r.contentHash])).rejects.toMatchObject({ code: "23503" });
  });
  test("a matching foreign-actor confirmation/submission pair cannot become accepted", async () => {
    await seed(); const r = await save(), id = randomUUID();
    await expect(transaction(async db => {
      await db.query("INSERT INTO public.case_intake_confirmations (id,case_id,revision_id,actor_user_id,content_hash,case_version,acknowledgment_version) VALUES ($1,101,$2,43,$3,$4,'review-v1')", [id, r.revisionId, r.contentHash, r.caseVersion]);
      await db.query("INSERT INTO public.case_intake_submissions (case_id,revision_id,confirmation_id,actor_user_id,content_hash) VALUES (101,$1,$2,43,$3)", [r.revisionId, id, r.contentHash]);
      await db.query("UPDATE public.client_cases SET submitted_intake_revision_id=$1,interview_completed=true,intake_version=intake_version+1 WHERE id=101", [r.revisionId]);
    })).rejects.toMatchObject({ code: "P0001" });
    expect(await count("case_intake_confirmations")).toBe(0); expect(await count("case_intake_submissions")).toBe(0);
    expect(await service.acceptedIntake(pool, 101)).toBeNull();
  });
  test("database acceptance rejects an otherwise matching but obsolete confirmation", async () => {
    await seed(); const r = await save(), older = await confirm(r);
    const current = await service.confirmRevision(actor, 101, "confirm-again", { revisionId: r.revisionId, expectedVersion: older.caseVersion, acknowledgeReview: true, acknowledgmentVersion: "review-v1" });
    await expect(transaction(async db => {
      await db.query("INSERT INTO public.case_intake_submissions (case_id,revision_id,confirmation_id,actor_user_id,content_hash) VALUES (101,$1,$2,42,$3)", [r.revisionId, older.confirmationId, r.contentHash]);
      await db.query("UPDATE public.client_cases SET submitted_intake_revision_id=$1,interview_completed=true,intake_version=intake_version+1 WHERE id=101", [r.revisionId]);
    })).rejects.toMatchObject({ code: "P0001", message: "Current owning-client confirmation required" });
    expect(await count("case_intake_submissions")).toBe(0); expect(await count("case_intake_confirmations")).toBe(2);
    expect(await row()).toMatchObject({ intake_version: String(current.caseVersion), selected_intake_revision_id: r.revisionId, submitted_intake_revision_id: null });
    expect(await service.acceptedIntake(pool, 101)).toBeNull();
    expect((await submit(current)).confirmationId).toBe(current.confirmationId);
  });
  test.each(["admin", "advocate"])("%s cannot confirm through the actual service", async role => {
    await seed(); const r = await save();
    await expect(service.confirmRevision({ id: 42, role }, 101, "forged", { expectedVersion: r.caseVersion, revisionId: r.revisionId, acknowledgeReview: true, acknowledgmentVersion: "review-v1" })).rejects.toMatchObject({ status: 403 });
    expect(await count("case_intake_confirmations")).toBe(0);
  });
  test("another owning-client identity cannot confirm this case", async () => {
    await seed(); const r = await save();
    await expect(service.confirmRevision({ id: 43, role: "client" }, 101, "forged", { expectedVersion: r.caseVersion, revisionId: r.revisionId, acknowledgeReview: true, acknowledgmentVersion: "review-v1" })).rejects.toMatchObject({ status: 404 });
    expect(await count("case_intake_confirmations")).toBe(0);
  });
  test("a late receipt constraint failure rolls back revision, selection and version", async () => {
    await seed(); await real.query("ALTER TABLE public.case_intake_receipts ADD CONSTRAINT fixture_reject_save CHECK(operation<>'save')");
    await expect(save()).rejects.toMatchObject({ code: "23514" });
    expect(await count("case_intake_revisions")).toBe(0); expect(await count("case_intake_receipts")).toBe(0);
    expect(await row()).toMatchObject({ intake_version: "1", selected_intake_revision_id: null });
  });
  test("a late lifecycle failure rolls back submission and remains safely retryable", async () => {
    await seed(); const r = await save(), c = await confirm(r);
    await real.query("ALTER TABLE public.case_lifecycle_events ADD CONSTRAINT fixture_reject_submission_event CHECK(to_status<>'MATCHING_REVIEW')");
    await expect(submit(c)).rejects.toMatchObject({ code: "23514" });
    expect(await count("case_intake_submissions")).toBe(0);
    expect(await row()).toMatchObject({ intake_version: String(c.caseVersion), submitted_intake_revision_id: null, interview_completed: false, status: "INTAKE_STARTED" });
    await real.query("ALTER TABLE public.case_lifecycle_events DROP CONSTRAINT fixture_reject_submission_event");
    expect((await submit(c)).revisionId).toBe(r.revisionId);
  });
  test("Prepare/Stop race deleting the RAM proposal leaves no partial database record", async () => {
    await seed(); await expect(save("save-one", async () => { throw new Error("Fictional proposal deleted by Stop"); })).rejects.toThrow("deleted by Stop");
    expect(await count("case_intake_revisions")).toBe(0); expect(await count("case_intake_receipts")).toBe(0);
    expect((await row()).intake_version).toBe("1");
  });
  test("unknown admission persists quarantine and does not dispatch twice", async () => {
    await seed(101, 42, false); live.admit.mockRejectedValueOnce(new Error("Fictional unknown admission outcome"));
    expect((await post()).status).toBe(500); const second = await post();
    expect(second.status).toBe(409); expect(second.body.code).toBe("ADMISSION_OUTCOME_UNKNOWN");
    expect(live.admit).toHaveBeenCalledTimes(1);
    expect(await row()).toMatchObject({ status: "DRAFT", intake_protocol: "live_v2", intake_version: "1" });
    expect((await real.query("SELECT response FROM public.case_intake_receipts")).rows).toEqual([{ response: null }]);
  });
  test("real session-binding failure rolls back phase two and stops the known orphan", async () => {
    await seed(101, 42, false);
    await real.query("ALTER TABLE public.case_intake_live_sessions ADD CONSTRAINT fixture_reject_binding CHECK(session_id<>'fictional-admitted')");
    expect((await post()).status).toBe(500);
    expect(live.stop).toHaveBeenCalledWith(actor, 101, "fictional-admitted");
    expect(await count("case_intake_live_sessions")).toBe(0); expect((await row()).status).toBe("DRAFT");
    expect((await post()).body.code).toBe("ADMISSION_OUTCOME_UNKNOWN"); expect(live.admit).toHaveBeenCalledTimes(1);
  });
  test.each(legacyWrites)("admission first: a concurrent legacy %s INSERT waits, then is rejected", async (_kind, sql) => {
    await seed(101, 42, false); const holder = await lease();
    await holder.query("BEGIN"); await holder.query("SELECT id FROM public.client_cases WHERE id=101 FOR UPDATE");
    const admission = post().then(response => response); await attempt(1); await blocked(lockAttempts[0], holder.processID);
    const writer = await lease(); const legacy = writer.query(sql).then(value => ({ value }), error => ({ error }));
    await blocked(writer.processID); await holder.query("COMMIT"); release(holder);
    const [response, outcome] = await Promise.all([admission, legacy]); release(writer);
    expect(response.status).toBe(200); expect(outcome.error).toMatchObject({ code: "P0001" });
    expect(await count("case_intake_sessions")).toBe(0); expect(await count("case_voice_notes")).toBe(0);
  });
  test.each(legacyWrites)("legacy %s first: waiting admission sees history and never dispatches", async (_kind, sql) => {
    await seed(101, 42, false); const writer = await lease(); await writer.query("BEGIN"); await writer.query(sql);
    const admission = post().then(response => response); await attempt(1); await blocked(lockAttempts[0], writer.processID);
    await writer.query("COMMIT"); release(writer); const response = await admission;
    expect(response.status).toBe(409); expect(response.body.code).toBe("LEGACY_INTAKE_HISTORY");
    expect(live.admit).not.toHaveBeenCalled(); expect((await row()).intake_protocol).toBe("legacy");
  });
  repositoryTest("repository constraints remain strict and the application connection is not an owner", async () => {
    const role = (await runtime.query(`SELECT current_user,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,
      c.relowner=r.oid AS owns_cases FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_class c
      ON c.oid='public.client_cases'::regclass WHERE r.rolname=current_user`)).rows[0];
    expect(role).toMatchObject({ current_user: "reviewed_intake_fixture_runtime", rolsuper: false,
      rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, owns_cases: false });
    await expect(runtime.query("ALTER TABLE public.client_cases ADD COLUMN fixture_forbidden TEXT")).rejects.toMatchObject({ code: "42501" });
    await expect(real.query("INSERT INTO public.users (id,name,role) VALUES (99,'Fictional invalid seed','client')")).rejects.toMatchObject({ code: "23502" });
    await expect(real.query("INSERT INTO public.client_cases (id,user_id) VALUES (103,42)")).rejects.toMatchObject({ code: "23502" });
    await seed(101,42,false);
    await expect(real.query("INSERT INTO public.case_voice_notes (case_id,notes) VALUES (101,'Fictional invalid seed')")).rejects.toMatchObject({ code: "23502" });
    expect((await real.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='client_cases' AND column_name='interview_completed'")).rows[0].is_nullable).toBe("YES");
  });
  repositoryTest("a legacy NULL completion flag stays unknown until explicit reviewed submission", async () => {
    await seed(101,42,false); await real.query("UPDATE public.client_cases SET interview_completed=NULL WHERE id=101");
    live.admit.mockResolvedValueOnce({ sessionId: "live-101", expiresAt: new Date(Date.now()+240000).toISOString() });
    expect((await post()).status).toBe(200); expect((await row()).interview_completed).toBeNull();
    const r = await save(), c = await confirm(r); expect((await row()).interview_completed).toBeNull();
    expect(await service.acceptedIntake(pool,101)).toBeNull(); await submit(c);
    expect((await row()).interview_completed).toBe(true);
  });
  repositoryTest("saved review reloads without live binding using the non-owner service role", async () => {
    await seed(); const r = await save(); await real.query("DELETE FROM public.case_intake_live_sessions");
    const review = await request(server).get("/cases/101/intake/review");
    expect(review.status).toBe(200); expect(review.headers["cache-control"]).toBe("no-store");
    expect(review.body.revision).toMatchObject({ revisionId: r.revisionId, reviewedData: r.reviewedData, inputTailComplete: false });
    const c = await confirm(r);
    expect((await request(server).get("/cases/101/intake/review")).body.confirmation.confirmationId).toBe(c.confirmationId);
    await submit(c); const accepted = await request(server).get("/cases/101/intake/review");
    expect(accepted.body).toMatchObject({ submittedRevisionId: r.revisionId, status: "MATCHING_REVIEW" });
  });
  repositoryTest("owning-case deletion also cascades actual document, matching and payment-event references", async () => {
    await seed(); await submit(await confirm(await save()));
    await real.query("INSERT INTO public.case_documents (case_id,file_url) VALUES (101,'https://example.invalid/fictional.pdf')");
    const run = (await real.query("INSERT INTO public.case_matching_runs (case_id,triggered_by) VALUES (101,42) RETURNING id")).rows[0].id;
    await real.query("INSERT INTO public.case_match_candidates (run_id,case_id,advocate_id,rank_position,total_score) VALUES ($1,101,77,1,1)",[run]);
    await real.query("INSERT INTO public.case_payment_events (case_id,event_type,actor_user_id) VALUES (101,'FICTIONAL_CASCADE_PROBE',42)");
    await real.query("DELETE FROM public.client_cases WHERE id=101");
    for (const table of ["case_documents","case_matching_runs","case_match_candidates","case_payment_events","case_intake_revisions","case_intake_submissions"]) expect(await count(table)).toBe(0);
    expect(await count("users")).toBe(4);
  });
  test("legacy UPDATE cannot attach historical evidence to a reviewed case", async () => {
    await seed(); await seed(102, 42, false);
    await real.query("INSERT INTO public.case_intake_sessions (session_id,case_id,user_id) VALUES ('old-fictional',102,42)");
    await expect(real.query("UPDATE public.case_intake_sessions SET case_id=101 WHERE session_id='old-fictional'")).rejects.toMatchObject({ code: "P0001" });
  });
  const charge = async (n, age = "1 hour", actorId = 42) => {
    await real.query(`INSERT INTO public.interview_admissions(actor_user_id,case_id,intent_key,request_hash,outcome,created_at,active_until)
      SELECT $1,999,'seed-'||g,repeat('a',64),'accepted',clock_timestamp()-$3::interval,clock_timestamp()-INTERVAL '1 minute'
      FROM generate_series(1,$2::int) g`, [actorId,n,age]);
  };
  test("durable daily window survives case deletion and service rereads", async () => {
    await seed(101,42,false); await charge(2);
    expect((await post()).body.code).toBe("INTERVIEW_DAILY_LIMIT");
    await real.query("DELETE FROM public.client_cases WHERE id=101");
    await seed(101,42,false);
    expect((await service.getReview(actor,101)).interviewAllowance.reason).toBe("daily_limit");
    expect(live.admit).not.toHaveBeenCalled();
  });
  test("rolling 24h and 7d boundaries exclude expired charges", async () => {
    await seed(101,42,false); await charge(2,"24 hours");
    expect((await service.getReview(actor,101)).interviewAllowance.canStart).toBe(true);
    await real.query("TRUNCATE public.interview_admissions"); await charge(5,"6 days 23 hours");
    expect((await post()).body.code).toBe("INTERVIEW_WEEKLY_LIMIT");
    await real.query("UPDATE public.interview_admissions SET created_at=clock_timestamp()-INTERVAL '7 days'");
    expect((await service.getReview(actor,101)).interviewAllowance.canStart).toBe(true);
  });
  test("global window denies another account without exposing counts", async () => {
    await seed(101,42,false); await charge(25,"1 hour",43);
    const response=await post(); expect(response.status).toBe(429);
    expect(response.body.code).toBe("INTERVIEW_PLATFORM_LIMIT");
    expect(response.body.retryAt).toBeDefined(); expect(response.headers['retry-after']).toBeDefined();
  });
  test("cross-case simultaneous reservations share durable account active fence", async () => {
    await seed(101,42,false); await seed(102,42,false);
    const first=defer(), finish=defer();
    live.admit.mockImplementationOnce(async()=>{first.resolve();await finish.promise;throw new Error('uncertain');});
    const a=post().then(x=>x); await first.promise;
    const b=await request(server).post('/cases/102/intake/sessions').set('Idempotency-Key','other').send({expectedVersion:0,processingConsent:true});
    finish.resolve(); await a;
    expect(b.body.code).toBe('INTERVIEW_ALREADY_ACTIVE');
    expect(await count('interview_admissions')).toBe(1); expect(live.admit).toHaveBeenCalledTimes(1);
    expect((await service.getReview(actor,101)).interviewAllowance.hasPreviousInterview).toBe(true);
    expect((await post()).body.code).toBe('ADMISSION_OUTCOME_UNKNOWN');
  });
  test("only known rejection refunds; pause leaves ordinary review and stop available", async()=>{
    await seed(101,42,false);
    live.admit.mockRejectedValueOnce(Object.assign(new Error('local busy'),{status:503,code:'LIVE_BUSY',definitiveAdmissionRejection:true}));
    expect((await post()).status).toBe(503);
    expect((await real.query('SELECT outcome FROM public.interview_admissions')).rows[0].outcome).toBe('refunded');
    expect((await service.getReview(actor,101)).interviewAllowance.hasPreviousInterview).toBe(false);
    await real.query('UPDATE public.interview_admission_policy SET paused=true');
    expect((await service.getReview(actor,101)).interviewAllowance.reason).toBe('paused');
  });
  test("missing admission policy preserves saved review and corrections but blocks new interviews",async()=>{
    await seed(); const saved=await save(); await confirm(saved);
    await real.query('DELETE FROM public.interview_admission_policy');
    try {
      const review=await service.getReview(actor,101);
      expect(review.revision.revisionId).toBe(saved.revisionId);
      expect(review.interviewAllowance).toMatchObject({canStart:false,reason:'paused'});
      await expect(service.editRevision(actor,101,'policy-missing-edit',{expectedVersion:review.caseVersion,revisionId:saved.revisionId,reviewedData:saved.reviewedData})).resolves.toHaveProperty('revisionId');
      const response=await request(server).post('/cases/101/intake/sessions').set('Idempotency-Key','policy-missing-start').send({expectedVersion:Number((await row()).intake_version),processingConsent:true,newInterview:true});
      expect(response.status).toBe(503); expect(response.body.code).toBe('INTERVIEWS_PAUSED');
      expect(live.admit).not.toHaveBeenCalled();
    } finally { await real.query('INSERT INTO public.interview_admission_policy(singleton) VALUES (true)'); }
  });
  test("migration backfills accepted and uncertain history without charging known rejections",()=>{
    expect(backfilledAdmissions).toEqual([
      {intent_key:'backfill-accepted',outcome:'accepted',session_id:'fictional-backfill',active:true},
      {intent_key:'backfill-rejected',outcome:'refunded',session_id:null,active:true},
      {intent_key:'backfill-unknown',outcome:'reserved',session_id:null,active:true},
    ]);
  });
  test("repeat preserves selected parent, fences current confirmation, and advances version",async()=>{
    await seed(); const old=await save(), confirmed=await confirm(old);
    const missing=await post({expectedVersion:confirmed.caseVersion,processingConsent:true});
    expect(missing.body.code).toBe('NEW_INTERVIEW_CONFIRMATION_REQUIRED');
    const started=await request(server).post('/cases/101/intake/sessions').set('Idempotency-Key','repeat').send({expectedVersion:confirmed.caseVersion,processingConsent:true,newInterview:true});
    expect(started.status).toBe(200);
    expect((await row()).selected_intake_revision_id).toBe(old.revisionId);
    expect((await service.getReview(actor,101)).confirmation).toBeNull();
    await expect(service.confirmRevision(actor,101,'cross-tab',{expectedVersion:started.body.caseVersion,revisionId:old.revisionId,acknowledgeReview:true,acknowledgmentVersion:'review-v1'})).rejects.toMatchObject({code:'INTERVIEW_ALREADY_ACTIVE'});
    const replacement=await service.saveProposal(actor,101,'replacement',{expectedVersion:started.body.caseVersion,sessionId:'fictional-admitted'},async()=>({...proposal(),session_id:'fictional-admitted'}));
    expect((await real.query('SELECT parent_id FROM public.case_intake_revisions WHERE id=$1',[replacement.revisionId])).rows[0].parent_id).toBe(old.revisionId);
  });

  test("singleton lock serializes competing accounts at global admission 25",async()=>{
    await seed(101,42,false);await seed(102,43,false);await charge(24,'1 hour',77);
    const holder=await lease(); await holder.query('BEGIN');
    await holder.query('SELECT * FROM public.interview_admission_policy FOR UPDATE');
    const a=post().then(value=>value);
    const b=request(server).post('/cases/102/intake/sessions').set('x-fixture-user','43').set('Idempotency-Key','competing').send({expectedVersion:0,processingConsent:true}).then(value=>value);
    try { await attempt(2); }
    finally { await holder.query('COMMIT'); release(holder); }
    const results=await Promise.all([a,b]);
    expect(results.map(value=>value.status).sort()).toEqual([200,429]);
    expect(results.find(value=>value.status===429).body.code).toBe('INTERVIEW_PLATFORM_LIMIT');
    expect(await count('interview_admissions')).toBe(25);expect(live.admit).toHaveBeenCalledTimes(1);
  });

});
