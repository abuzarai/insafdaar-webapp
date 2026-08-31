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

describe("Advocate profile API tests", () => {
  let app;
  const token = jwt.sign(
    { id: 77, email: "advocate@insafdaar.test", role: "advocate" },
    process.env.JWT_SECRET
  );

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    app = buildTestApp();
  });

  test("test_avatar_upload_success", async () => {
    const response = await request(app)
      .post("/api/advocate/dashboard/profile/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("fake image bytes"), {
        filename: "me.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ message: "Avatar updated" });
    expect(response.body.avatarUrl).toContain("/uploads/avatars/");
  });

  test("test_avatar_upload_missing_file", async () => {
    const response = await request(app)
      .post("/api/advocate/dashboard/profile/avatar")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Avatar file is required");
  });

  test("test_avatar_upload_invalid_mime_type", async () => {
    const response = await request(app)
      .post("/api/advocate/dashboard/profile/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("not an image"), {
        filename: "script.exe",
        contentType: "application/octet-stream",
      });

    expect(response.status).toBe(500);
    expect(response.body.error).toContain("Only PNG, JPG, or WEBP images are allowed");
  });

  test("test_avatar_upload_requires_auth", async () => {
    const response = await request(app)
      .post("/api/advocate/dashboard/profile/avatar")
      .attach("file", Buffer.from("fake image bytes"), {
        filename: "me.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(401);
  });
});