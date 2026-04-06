import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  fetchAccounts,
  fetchXhsAuthStatus,
  resolveApiBaseUrl,
  syncXhsAuthWithPlaywright,
} from "@/lib/api";

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

  it("uses the Vite /api proxy in dev for local backend URLs", () => {
    expect(
      resolveApiBaseUrl({
        DEV: true,
        VITE_API_BASE_URL: "http://localhost:8000/api",
      }),
    ).toBe("/api");
  });

  it("keeps explicit remote api base URLs in dev", () => {
    expect(
      resolveApiBaseUrl({
        DEV: true,
        VITE_API_BASE_URL: "https://api.example.com/api",
      }),
    ).toBe("https://api.example.com/api");
  });

  it("does not force json content-type for get requests", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await fetchAccounts();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("maps cookie-based auth status to canIngest=true", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          has_token: false,
          has_cookie: true,
          can_ingest: true,
          login_url: "https://www.xiaohongshu.com",
          auth_mode: "cookie",
          next_action: "retry",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(fetchXhsAuthStatus()).resolves.toEqual(
      expect.objectContaining({
        hasToken: false,
        hasCookie: true,
        canIngest: true,
        authMode: "cookie",
        nextAction: "retry",
      }),
    );
  });

  it("maps playwright sync response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          has_cookie: true,
          updated_at: "2026-03-23T10:00:00Z",
          message: "Synced",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(syncXhsAuthWithPlaywright(90)).resolves.toEqual({
      success: true,
      hasCookie: true,
      updatedAt: "2026-03-23T10:00:00Z",
      message: "Synced",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/xhs/auth/playwright/sync?timeout_seconds=90"),
      expect.any(Object),
    );
  });

  it("adds json content-type when posting a body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          account: {
            id: "acc-1",
            name: "tester",
            xhs_id: "xhs-1",
            platform: "xiaohongshu",
            avatar: "A",
            post_count: 1,
          },
          post: {
            id: "note-1",
            account_id: "acc-1",
            content: "post",
            likes: 1,
            shares: 2,
            comments: 3,
            collects: 4,
            views: 5,
            growth_rate: 0.1,
            status: "normal",
            timestamp: "2026-03-23T10:00:00Z",
            history: [1, 2, 3],
          },
          cached_key: "cache-1",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const { ingestNote } = await import("@/lib/api");
    await ingestNote({ url: "https://www.xiaohongshu.com/user/profile/tester" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
