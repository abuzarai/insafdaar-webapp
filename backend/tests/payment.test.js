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
    app = buildTestApp();
  });

  test("test_get_invoices_success", async () => {
    dbQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 501,
          case_id: 999,
          case_title: "Property Dispute",
          amount: "25000.00",
          status: "ISSUED",
        },
      ],
      rowCount: 1,
    });

    const response = await request(app)
      .get("/api/client/dashboard/billing/invoices")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.invoices).toHaveLength(1);
    expect(response.body.invoices[0]).toMatchObject({
      id: 501,
      case_title: "Property Dispute",
    });
  });

  test("test_get_invoice_by_id_not_found", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await request(app)
      .get("/api/client/dashboard/billing/invoices/402")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Invoice not found");
  });

  test("test_upload_invoice_proof_missing_file", async () => {
    const response = await request(app)
      .post("/api/client/dashboard/billing/invoices/1001/proof")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Payment proof file is required");
  });

  test("test_upload_invoice_proof_verified_locked", async () => {
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ id: 1001, payment_proof_status: "VERIFIED" }],
      rowCount: 1,
    });

    const response = await request(app)
      .post("/api/client/dashboard/billing/invoices/1001/proof")
      .set("Authorization", `Bearer ${token}`)
      .attach("proof", Buffer.from("fake png bytes"), {
        filename: "proof.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Upload is locked");
  });

  test("test_upload_invoice_proof_success", async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 1001, payment_proof_status: "REJECTED" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const response = await request(app)
      .post("/api/client/dashboard/billing/invoices/1001/proof")
      .set("Authorization", `Bearer ${token}`)
      .attach("proof", Buffer.from("fake pdf bytes"), {
        filename: "payment.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      paymentProofStatus: "UPLOADED",
    });
    expect(response.body.paymentProofUrl).toContain("/uploads/billing-proofs/");
  });

  test("test_upload_invoice_proof_invalid_mime_type", async () => {
    const response = await request(app)
      .post("/api/client/dashboard/billing/invoices/1001/proof")
      .set("Authorization", `Bearer ${token}`)
      .attach("proof", Buffer.from("not allowed"), {
        filename: "script.exe",
        contentType: "application/octet-stream",
      });

    expect(response.status).toBe(500);
    expect(response.body.error).toContain("Only PNG, JPG, JPEG, or PDF files are allowed");
  });
});
