import { jest, describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";

const dbQueryMock = jest.fn();

jest.unstable_mockModule("../db.js", () => ({
  default: {
    query: dbQueryMock,
  },
}));

const appModule = await import("./helpers/buildTestApp.js");
const { buildTestApp } = appModule;

describe("Authenticated upload serving (audit #17-2)", () => {
  let app;
  let avFile;
  let docFile;

  const tokenFor = (id, role) =>
    jwt.sign({ id, email: `u${id}@insafdaar.test`, role }, process.env.JWT_SECRET);

  beforeAll(() => {
    fs.mkdirSync(path.resolve("uploads/avatars"), { recursive: true });
    fs.mkdirSync(path.resolve("uploads/documents"), { recursive: true });
    avFile = path.resolve("uploads/avatars/probe-avatar.png");
    docFile = path.resolve("uploads/documents/probe-doc.pdf");
    fs.writeFileSync(avFile, "avatar-bytes");
    fs.writeFileSync(docFile, "doc-bytes");
  });

  afterAll(() => {
    if (fs.existsSync(avFile)) fs.unlinkSync(avFile);
    if (fs.existsSync(docFile)) fs.unlinkSync(docFile);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueryMock.mockReset();
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    app = buildTestApp();
  });

  test("avatars are public (no token needed)", async () => {
    const res = await request(app).get("/uploads/avatars/probe-avatar.png");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  test("non-avatar files require a JWT", async () => {
    const res = await request(app).get("/uploads/documents/probe-doc.pdf");
    expect(res.status).toBe(401);
  });

  test("documents: owner client is allowed", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ user_id: 88 }], rowCount: 1 });
    const res = await request(app)
      .get("/uploads/documents/probe-doc.pdf")
      .set("Authorization", `Bearer ${tokenFor(88, "client")}`);
    expect(res.status).toBe(200);
  });

  test("documents: another client is denied", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ user_id: 88 }], rowCount: 1 });
    const res = await request(app)
      .get("/uploads/documents/probe-doc.pdf")
      .set("Authorization", `Bearer ${tokenFor(99, "client")}`);
    expect(res.status).toBe(403);
  });

  test("documents: assigned advocate is allowed", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ user_id: 88 }], rowCount: 1 })
      .mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
    const res = await request(app)
      .get("/uploads/documents/probe-doc.pdf")
      .set("Authorization", `Bearer ${tokenFor(77, "advocate")}`);
    expect(res.status).toBe(200);
  });

  test("case buckets: unassigned advocate is denied", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ case_id: 500 }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get("/uploads/case-audio/probe.m4a")
      .set("Authorization", `Bearer ${tokenFor(77, "advocate")}`);
    expect(res.status).toBe(403);
  });

  test("unknown bucket is denied even with valid token", async () => {
    const res = await request(app)
      .get("/uploads/internal/secret.txt")
      .set("Authorization", `Bearer ${tokenFor(77, "advocate")}`);
    expect(res.status).toBe(403);
  });

  test("traversal is rejected", async () => {
    const res = await request(app)
      .get("/uploads/documents/..%2Fserver.js")
      .set("Authorization", `Bearer ${tokenFor(1, "admin")}`);
    expect([400, 403, 404]).toContain(res.status);
  });
});