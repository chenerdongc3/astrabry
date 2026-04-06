import { ApiError } from "@/lib/api";

const DEFAULT_XHS_LOGIN_URL = "https://www.xiaohongshu.com";
const AUTH_GUIDE_COOLDOWN_MS = 12_000;

let lastGuidedAt = 0;
let lastGuidedUrl = "";

interface XhsAuthRequiredDetail {
  code?: unknown;
  login_url?: unknown;
  message?: unknown;
}

export interface XhsAuthRequiredInfo {
  loginUrl: string;
  message?: string;
}

export type XhsWorkflowState =
  | "idle"
  | "awaiting_auth"
  | "syncing_auth"
  | "ingesting"
  | "refreshing"
  | "error";

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
};

export function getXhsAuthRequiredInfo(error: Error): XhsAuthRequiredInfo | null {
  if (!(error instanceof ApiError) || error.status !== 401) {
    return null;
  }

  const detailObj = asObject(error.detail);
  if (!detailObj) {
    return null;
  }

  const detail = detailObj as XhsAuthRequiredDetail;
  if (detail.code !== "XHS_AUTH_REQUIRED") {
    return null;
  }

  const loginUrl =
    typeof detail.login_url === "string" && detail.login_url.trim()
      ? detail.login_url.trim()
      : DEFAULT_XHS_LOGIN_URL;

  const message =
    typeof detail.message === "string" && detail.message.trim()
      ? detail.message.trim()
      : undefined;

  return { loginUrl, message };
}

export function isSupportedXhsUrl(value: string): boolean {
  const nextValue = value.trim();
  if (!nextValue) {
    return false;
  }

  try {
    const parsed = new URL(nextValue);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "xiaohongshu.com" ||
      hostname.endsWith(".xiaohongshu.com") ||
      hostname === "xhslink.com" ||
      hostname.endsWith(".xhslink.com")
    );
  } catch {
    return false;
  }
}

export function shouldAutoOpenXhsLogin(loginUrl: string, now = Date.now()): boolean {
  const normalizedUrl = loginUrl.trim() || DEFAULT_XHS_LOGIN_URL;
  const isSameLoginUrl = normalizedUrl === lastGuidedUrl;
  const withinCooldown = now - lastGuidedAt < AUTH_GUIDE_COOLDOWN_MS;

  if (isSameLoginUrl && withinCooldown) {
    return false;
  }

  lastGuidedAt = now;
  lastGuidedUrl = normalizedUrl;
  return true;
}
