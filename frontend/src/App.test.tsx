import { describe, test, expect, beforeEach } from "@jest/globals";
import { isLoggedIn } from "./utils/auth";

describe("auth utilities", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("isLoggedIn is false without a token", () => {
    expect(isLoggedIn()).toBe(false);
  });

  test("isLoggedIn is false for a short/junk token", () => {
    localStorage.setItem("token", "abc");
    expect(isLoggedIn()).toBe(false);
  });

  test("isLoggedIn is false for a long junk token", () => {
    localStorage.setItem("token", "eyJhbGciOiJIUzI1NiJ9.0123456789abcdefghijklmnopqrstuvwxyz");
    expect(isLoggedIn()).toBe(false);
  });

  test("isLoggedIn requires an unexpired supported session role", () => {
    const payload = btoa(JSON.stringify({ role: "client", exp: Date.now() / 1000 + 3600 }));
    localStorage.setItem("token", `offline.${payload}.fixture`);
    localStorage.setItem("user", JSON.stringify({ role: "client" }));
    expect(isLoggedIn()).toBe(true);
  });
});