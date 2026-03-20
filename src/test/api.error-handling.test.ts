import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, fetchAccounts } from "@/lib/api";

describe("api error handling", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses string detail as ApiError message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Token expired" }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      await fetchAccounts();
      throw new Error("Expected fetchAccounts to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.message).toBe("Token expired");
      expect(apiError.detail).toBe("Token expired");
    }
  });

  it("parses object detail.message and keeps structured detail", async () => {
    const detail = {
      code: "XHS_AUTH_REQUIRED",
      message: "Need Xiaohongshu login",
      login_url: "https://www.xiaohongshu.com/login",
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      await fetchAccounts();
      throw new Error("Expected fetchAccounts to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.message).toBe("Need Xiaohongshu login");
      expect(apiError.detail).toEqual(detail);
    }
  });

  it("falls back to statusText when error body is not valid JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Internal server error", {
        status: 500,
        statusText: "Server Error",
        headers: { "Content-Type": "text/plain" },
      }),
    );

    try {
      await fetchAccounts();
      throw new Error("Expected fetchAccounts to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.status).toBe(500);
      expect(apiError.message).toBe("Server Error");
      expect(apiError.detail).toBeUndefined();
    }
  });

  it("adds backend reachability hint for network failures", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    try {
      await fetchAccounts();
      throw new Error("Expected fetchAccounts to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("Failed to fetch");
      expect(message).toContain("请确认后端");
    }
  });
});
