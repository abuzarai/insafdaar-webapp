import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import bcrypt from "bcryptjs";

const dbQueryMock = jest.fn();
const dbConnectMock = jest.fn();

jest.unstable_mockModule("../db.js", () => ({
  default: {
    query: dbQueryMock,
    connect: dbConnectMock,
  },
}));

const sendOtpEmailMock = jest.fn();
jest.unstable_mockModule("../utils/mailer.js", () => ({
  sendOtpEmail: sendOtpEmailMock,
  sendNotificationEmail: jest.fn(),
}));

const hashOtpMock = jest.fn(async () => "otp-hash");
jest.unstable_mockModule("../utils/otp.js", () => ({
  generateOtp: jest.fn(() => "123456"),
  hashOtp: hashOtpMock,
}));

const appModule = await import("./helpers/buildTestApp.js");
const { buildTestApp } = appModule;

describe("Auth and registration API tests", () => {
  let app;
  let dbClient;

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueryMock.mockReset();
    dbConnectMock.mockReset();
    sendOtpEmailMock.mockReset();
    hashOtpMock.mockReset().mockResolvedValue("otp-hash");
    app = buildTestApp();

    dbClient = {
      query: jest.fn(),
      release: jest.fn(),
    };

    dbConnectMock.mockResolvedValue(dbClient);
  });

  test("test_user_registration_success", async () => {
    dbClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 101, email: "sara@example.com" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const payload = {
      name: "Sara Khan",
      email: "sara@example.com",
      password: "StrongPass123!",
      cnic: "35202-1234567-8",
      phone: "+923001234567",
    };

    const response = await request(app).post("/api/register/client").send(payload);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      message: "OTP sent to email",
      redirect: "/verify-otp",
      email: "sara@example.com",
    });
    expect(hashOtpMock).toHaveBeenCalledWith("123456");
    expect(sendOtpEmailMock).toHaveBeenCalledWith("sara@example.com", "123456");
    expect(dbClient.release).toHaveBeenCalled();
  });

  test("test_user_registration_missing_required_fields", async () => {
    const response = await request(app).post("/api/register/client").send({
      name: "",
      email: "",
      password: "",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Required fields missing.");
    expect(dbClient.query).not.toHaveBeenCalled();
  });

  test("test_user_registration_duplicate_email", async () => {
    dbClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await request(app).post("/api/register/client").send({
      name: "Ali",
      email: "existing@example.com",
      password: "Pass123!",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("User already exists.");
    expect(sendOtpEmailMock).not.toHaveBeenCalled();
  });

  test("test_user_login_success", async () => {
    const hashedPassword = await bcrypt.hash("StrongPass123!", 10);
    dbQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 7,
          name: "Ayesha",
          email: "ayesha@example.com",
          password: hashedPassword,
          role: "client",
        },
      ],
    });

    const response = await request(app).post("/api/auth/login").send({
      email: "ayesha@example.com",
      password: "StrongPass123!",
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Login successful");
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({
      id: 7,
      role: "client",
    });
  });

  test("test_user_login_invalid_credentials", async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const response = await request(app).post("/api/auth/login").send({
      email: "missing@example.com",
      password: "password",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid email or password");
  });

  test("test_verify_otp_success", async () => {
    const otpHash = await bcrypt.hash("123456", 10);
    dbQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // ensure lockout columns
      .mockResolvedValueOnce({ rows: [{ id: 23, email_verified: false }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 91,
            otp_hash: otpHash,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            used: false,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const response = await request(app).post("/api/auth/verify-otp").send({
      email: "sara@example.com",
      otp: "123456",
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Email verified successfully ");
  });

  test("test_verify_otp_expired", async () => {
    const otpHash = await bcrypt.hash("123456", 10);
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 23, email_verified: false }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 91,
            otp_hash: otpHash,
            expires_at: new Date(Date.now() - 60_000).toISOString(),
            used: false,
          },
        ],
        rowCount: 1,
      });

    const response = await request(app).post("/api/auth/verify-otp").send({
      email: "sara@example.com",
      otp: "123456",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("OTP expired. Please request a new OTP.");
  });

  test("test_get_profile_unauthenticated", async () => {
    const response = await request(app).get("/api/auth/profile");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Unauthorized");
  });
});
