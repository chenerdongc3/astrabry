import type { MonitoredAccount, Post } from "./data";

const DEFAULT_API_BASE_URL = "http://localhost:8000/api";

const deriveBaseUrl = (): string => {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8000/api`;
  }
  return DEFAULT_API_BASE_URL;
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
  login_url: string;
  xsec_source?: string | null;
  updated_at?: string | null;
  ttl_seconds?: number | null;
  auth_error?: RawXhsAuthErrorDetail | null;
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
  loginUrl: string;
  xsecSource?: string;
  updatedAt?: string;
  ttlSeconds?: number;
  authError?: {
    code: string;
    message: string;
    loginUrl: string;
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
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
  return {
    hasToken: data.has_token,
    loginUrl: data.login_url,
    xsecSource: data.xsec_source ?? undefined,
    updatedAt: data.updated_at ?? undefined,
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

interface NoteIngestRequestPayload {
  url: string;
  account_id?: string;
  platform: "xiaohongshu";
}
