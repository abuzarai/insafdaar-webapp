import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";

const dbQueryMock = jest.fn();

jest.unstable_mockModule("../db.js", () => ({
  default: {
    query: dbQueryMock,
  },
}));

const appModule = await import("./helpers/buildTestApp.js");
const { buildTestApp } = appModule;

describe("Payment and billing API tests", () => {
  let app;
  const token = jwt.sign(
    { id: 88, email: "client@insafdaar.test", role: "client" },
    process.env.JWT_SECRET
  );

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    app = buildTestApp();
  });

  test("test_get_vouchers_success", async () => {
    dbQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 501,
          title: "Advance Fee",
          amount: "25000.00",
          status: "ISSUED_PENDING_PAYMENT",
        },
      ],
      rowCount: 1,
    });

    const response = await request(app)
      .get("/api/client/dashboard/billing/vouchers")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.vouchers).toHaveLength(1);
    expect(response.body.vouchers[0]).toMatchObject({
      id: 501,
      title: "Advance Fee",
    });
  });

  test("test_get_voucher_by_id_not_found", async () => {
    const response = await request(app)
      .get("/api/client/dashboard/billing/vouchers/402")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Voucher not found");
  });

  test("test_get_voucher_by_id_invalid_id", async () => {
    const response = await request(app)
      .get("/api/client/dashboard/billing/vouchers/not-a-number")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid voucher id");
  });

  test("test_upload_voucher_proof_missing_file", async () => {
    const response = await request(app)
      .post("/api/client/dashboard/billing/vouchers/1001/proof")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Payment proof file is required");
  });

  test("test_upload_voucher_proof_locked_status", async () => {
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ id: 1001, status: "VERIFIED", title: "Advance Fee", amount: "25000.00" }],
      rowCount: 1,
    });

    const response = await request(app)
      .post("/api/client/dashboard/billing/vouchers/1001/proof")
      .set("Authorization", `Bearer ${token}`)
      .attach("proof", Buffer.from("fake png bytes"), {
        filename: "proof.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Cannot upload proof when voucher status is VERIFIED");
  });

  test("test_upload_voucher_proof_success", async () => {
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ id: 1001, status: "PAYMENT_REJECTED", title: "Advance Fee", amount: "25000.00" }],
      rowCount: 1,
    });

    const response = await request(app)
      .post("/api/client/dashboard/billing/vouchers/1001/proof")
      .set("Authorization", `Bearer ${token}`)
      .attach("proof", Buffer.from("fake pdf bytes"), {
        filename: "payment.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      status: "PAYMENT_PROOF_UPLOADED",
    });
    expect(response.body.proof_file_url).toContain("/uploads/billing-proofs/");
  });

  test("test_upload_voucher_proof_invalid_mime_type", async () => {
    const response = await request(app)
      .post("/api/client/dashboard/billing/vouchers/1001/proof")
      .set("Authorization", `Bearer ${token}`)
      .attach("proof", Buffer.from("not allowed"), {
        filename: "script.exe",
        contentType: "application/octet-stream",
      });

    expect(response.status).toBe(500);
    expect(response.body.error).toContain("Only PNG, JPG, JPEG, or PDF files are allowed");
  });
});