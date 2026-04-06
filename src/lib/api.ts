import type { MonitoredAccount, Post } from "./data";

const DEFAULT_API_BASE_URL = "http://localhost:8000/api";

interface ApiBaseUrlEnv {
  DEV?: boolean;
  VITE_API_BASE_URL?: string;
}

const normalizeApiBaseUrl = (value: string): string => value.trim().replace(/\/+$/, "");

const isLocalDevApiUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    return (
      ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname) &&
      parsed.port === "8000" &&
      normalizedPath === "/api"
    );
  } catch {
    return false;
  }
};

export const resolveApiBaseUrl = (
  env: ApiBaseUrlEnv,
  location?: Pick<Location, "protocol" | "hostname">,
): string => {
  const configuredBaseUrl = env.VITE_API_BASE_URL ? normalizeApiBaseUrl(env.VITE_API_BASE_URL) : undefined;

  if (env.DEV) {
    if (!configuredBaseUrl || isLocalDevApiUrl(configuredBaseUrl)) {
      return "/api";
    }
    return configuredBaseUrl;
  }

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (location) {
    const { protocol, hostname } = location;
    return `${protocol}//${hostname}:8000/api`;
  }

  return DEFAULT_API_BASE_URL;
};

const deriveBaseUrl = (): string => {
  if (import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL) {
    return "/api";
  }

  return resolveApiBaseUrl(
    {
      DEV: import.meta.env.DEV,
      VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    },
    typeof window !== "undefined" && window.location ? window.location : undefined,
  );
};

const API_BASE_URL = deriveBaseUrl();

interface RawMonitoredAccount {
  id: string;
  name: string;
  xhs_id: string;
  platform: string;
  avatar: string;
  post_count: number;
  profile_url?: string | null;
}

interface RawPost {
  id: string;
  account_id: string;
  url?: string | null;
  title?: string | null;
  content: string;
  likes: number;
  shares: number;
  comments: number;
  collects: number;
  views: number;
  growth_rate: number;
  status: "viral" | "normal" | "low";
  timestamp: string;
  history: number[];
  seo_keywords?: string[];
}

interface RawIngestResponse {
  account: RawMonitoredAccount;
  post: RawPost;
  cached_key: string;
  agent_task_id?: string | null;
}

interface RawXhsAuthErrorDetail {
  code: string;
  message: string;
  login_url: string;
}

interface RawXhsAuthStatus {
  has_token: boolean;
  has_cookie?: boolean;
  can_ingest?: boolean;
  login_url: string;
  auth_mode?: "token" | "cookie" | "none";
  next_action?: "login" | "sync" | "retry";
  xsec_source?: string | null;
  updated_at?: string | null;
  cookie_updated_at?: string | null;
  ttl_seconds?: number | null;
  auth_error?: RawXhsAuthErrorDetail | null;
}

interface RawXhsPlaywrightSyncResponse {
  success: boolean;
  has_cookie: boolean;
  updated_at?: string | null;
  message?: string | null;
}

interface RawRefreshAccountResult {
  account_id: string;
  success: boolean;
  refreshed_posts: number;
  error?: string | null;
}

interface RawAccountsRefreshResponse {
  total_accounts: number;
  refreshed_accounts: number;
  failed_accounts: number;
  total_posts: number;
  results: RawRefreshAccountResult[];
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface IngestResult {
  account: MonitoredAccount;
  post: Post;
  cachedKey: string;
  agentTaskId: string | null;
}

export interface XhsAuthStatus {
  hasToken: boolean;
  hasCookie?: boolean;
  canIngest: boolean;
  loginUrl: string;
  authMode: "token" | "cookie" | "none";
  nextAction: "login" | "sync" | "retry";
  xsecSource?: string;
  updatedAt?: string;
  cookieUpdatedAt?: string;
  ttlSeconds?: number;
  authError?: {
    code: string;
    message: string;
    loginUrl: string;
  };
}

export interface AccountsRefreshResult {
  totalAccounts: number;
  refreshedAccounts: number;
  failedAccounts: number;
  totalPosts: number;
  results: Array<{
    accountId: string;
    success: boolean;
    refreshedPosts: number;
    error?: string;
  }>;
}

export interface XhsPlaywrightSyncResult {
  success: boolean;
  hasCookie: boolean;
  updatedAt?: string;
  message?: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init.body !== null;
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Network error";
    throw new Error(`${message} — 请确认后端 ${API_BASE_URL} 是否可达`);
  }

  if (!response.ok) {
    let message = response.statusText;
    let detail: unknown = undefined;
    try {
      const errorBody = await response.json();
      detail = errorBody?.detail ?? errorBody;
      if (typeof detail === "string") {
        message = detail;
      } else if (
        detail &&
        typeof detail === "object" &&
        "message" in detail &&
        typeof detail.message === "string"
      ) {
        message = detail.message;
      }
    } catch {
      // ignore body parse errors
    }
    throw new ApiError(message || "Request failed", response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

const mapAccount = (raw: RawMonitoredAccount): MonitoredAccount => ({
  id: raw.id,
  name: raw.name,
  xhsId: raw.xhs_id,
  platform: raw.platform,
  avatar: raw.avatar,
  postCount: raw.post_count,
  profileUrl: raw.profile_url ?? undefined,
});

const mapPost = (raw: RawPost): Post => ({
  id: raw.id,
  accountId: raw.account_id,
  title: raw.title ?? undefined,
  content: raw.content,
  likes: raw.likes,
  shares: raw.shares,
  comments: raw.comments,
  collects: raw.collects,
  views: raw.views,
  growthRate: raw.growth_rate,
  status: raw.status,
  timestamp: raw.timestamp,
  history: raw.history,
  seoKeywords: raw.seo_keywords ?? [],
  url: raw.url ?? undefined,
});

export async function fetchAccounts(): Promise<MonitoredAccount[]> {
  const data = await apiFetch<RawMonitoredAccount[]>("/xhs/accounts");
  return data.map(mapAccount);
}

export async function fetchAccountNotes(accountId: string): Promise<Post[]> {
  const data = await apiFetch<RawPost[]>(`/xhs/accounts/${accountId}/notes`);
  return data.map(mapPost);
}

export async function ingestNote(input: { url: string; accountId?: string }): Promise<IngestResult> {
  const payload: NoteIngestRequestPayload = {
    url: input.url,
    account_id: input.accountId,
    platform: "xiaohongshu",
  };
  const data = await apiFetch<RawIngestResponse>("/xhs/notes/ingest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    account: mapAccount(data.account),
    post: mapPost(data.post),
    cachedKey: data.cached_key,
    agentTaskId: data.agent_task_id ?? null,
  };
}

export async function deleteAccount(accountId: string): Promise<void> {
  await apiFetch<void>(`/xhs/accounts/${accountId}`, { method: "DELETE" });
}

export async function fetchXhsAuthStatus(): Promise<XhsAuthStatus> {
  const data = await apiFetch<RawXhsAuthStatus>("/xhs/auth/status");
  const hasToken = data.has_token;
  const hasCookie = typeof data.has_cookie === "boolean" ? data.has_cookie : false;
  const canIngest = typeof data.can_ingest === "boolean" ? data.can_ingest : hasToken || hasCookie;
  return {
    hasToken,
    hasCookie,
    canIngest,
    loginUrl: data.login_url,
    authMode:
      data.auth_mode ??
      (hasToken ? "token" : hasCookie ? "cookie" : "none"),
    nextAction:
      data.next_action ??
      (canIngest ? "retry" : "login"),
    xsecSource: data.xsec_source ?? undefined,
    updatedAt: data.updated_at ?? undefined,
    cookieUpdatedAt: data.cookie_updated_at ?? undefined,
    ttlSeconds: typeof data.ttl_seconds === "number" ? data.ttl_seconds : undefined,
    authError: data.auth_error
      ? {
          code: data.auth_error.code,
          message: data.auth_error.message,
          loginUrl: data.auth_error.login_url,
        }
      : undefined,
  };
}

export async function syncXhsAuthWithPlaywright(
  timeoutSeconds = 180,
): Promise<XhsPlaywrightSyncResult> {
  const data = await apiFetch<RawXhsPlaywrightSyncResponse>(
    `/xhs/auth/playwright/sync?timeout_seconds=${timeoutSeconds}`,
    {
      method: "POST",
    },
  );

  return {
    success: data.success,
    hasCookie: data.has_cookie,
    updatedAt: data.updated_at ?? undefined,
    message: data.message ?? undefined,
  };
}

export async function refreshCachedAccounts(): Promise<AccountsRefreshResult> {
  const data = await apiFetch<RawAccountsRefreshResponse>("/xhs/accounts/refresh", {
    method: "POST",
  });
  return {
    totalAccounts: data.total_accounts,
    refreshedAccounts: data.refreshed_accounts,
    failedAccounts: data.failed_accounts,
    totalPosts: data.total_posts,
    results: data.results.map((item) => ({
      accountId: item.account_id,
      success: item.success,
      refreshedPosts: item.refreshed_posts,
      error: item.error ?? undefined,
    })),
  };
}

interface NoteIngestRequestPayload {
  url: string;
  account_id?: string;
  platform: "xiaohongshu";
}
