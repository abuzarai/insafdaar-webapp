import { jest, test, expect } from "@jest/globals";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { reviewedIntakeError } from "../middleware/reviewedIntakeError.js";

const base = "/api/client/dashboard/start-case/101/intake-v2";
const marker = "fictional-private-interview-marker";
function fixture() {
  const fallback = jest.fn(), app = express();
  app.use(express.json({ limit: 100 }));
  app.post(`${base}/failure`, (req, res, next) => next(new Error(marker)));
  app.use(reviewedIntakeError);
  app.use((error, req, res, next) => { fallback(error); res.status(500).json({ fallback: true }); });
  return { app, fallback };
}

test("control: actual Express JSON errors retain the request body, so logging the Error is unsafe", async () => {
  const app = express(); let captured;
  app.use(express.json());
  app.use((error, req, res, next) => { captured = error; res.sendStatus(400); });
  await request(app).post(`${base}/sessions/fictional/webrtc/offer`).set("Content-Type", "application/json").send(`{"sdp":"${marker}",`);
  expect(captured.body).toContain(marker);
});

test.each(["/sessions", "/sessions/fictional/webrtc/offer", "/sessions/fictional/prepare", "/revisions"])("malformed intake JSON at %s is sanitized before shared diagnostics", async suffix => {
  const { app, fallback } = fixture();
  const result = await request(app).post(base + suffix).set("Content-Type", "application/json").send(`{"text":"${marker}",`);
  expect(result.status).toBe(400);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(result.body).toEqual({ error: "Intake request could not be completed", code: "INTAKE_REQUEST_FAILED" });
  expect(JSON.stringify(result.body)).not.toContain(marker); expect(fallback).not.toHaveBeenCalled();
});

test("oversized intake JSON and unexpected errors retain only fixed public diagnostics", async () => {
  const { app, fallback } = fixture();
  const large = await request(app).post(base + "/sessions").send({ text: marker.repeat(20) });
  expect(large.status).toBe(413); expect(large.body.code).toBe("INTAKE_REQUEST_FAILED");
  const failed = await request(app).post(base + "/failure").send({});
  expect(failed.status).toBe(500); expect(JSON.stringify(failed.body)).not.toContain(marker);
  expect(fallback).not.toHaveBeenCalled();
});

test("only intake errors are intercepted and logger metadata is fixed", () => {
  const error = new Error(marker), next = jest.fn();
  reviewedIntakeError(error, { path: "/api/client/profile" }, {}, next);
  expect(next).toHaveBeenCalledWith(error);
  const res = { locals: {}, set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
  next.mockClear(); reviewedIntakeError(error, { path: base + "/sessions" }, res, next);
  expect(res.locals.errorMessage).toBe("INTAKE_REQUEST_FAILED"); expect(next).not.toHaveBeenCalled();
});

test("server installs the scoped sanitizer before its shared raw-error logger", () => {
  const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  expect(server).toContain('import { reviewedIntakeError } from "./middleware/reviewedIntakeError.js";');
  expect(server.indexOf("app.use(reviewedIntakeError)")).toBeGreaterThan(server.indexOf("app.use(express.json())"));
  expect(server.indexOf("app.use(reviewedIntakeError)")).toBeLessThan(server.indexOf('console.error("❌ ERROR:", err)'));
});
