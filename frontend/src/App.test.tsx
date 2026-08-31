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

  test("isLoggedIn is true for a real-length token", () => {
    localStorage.setItem("token", "eyJhbGciOiJIUzI1NiJ9.0123456789abcdefghijklmnopqrstuvwxyz");
    expect(isLoggedIn()).toBe(true);
  });
});