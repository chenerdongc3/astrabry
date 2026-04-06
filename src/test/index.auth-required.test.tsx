import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const testState = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    detail: unknown;

    constructor(message: string, status: number, detail: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.detail = detail;
    }
  }

  return {
    ApiError,
    fetchAccounts: vi.fn(),
    fetchAccountNotes: vi.fn(),
    fetchXhsAuthStatus: vi.fn(),
    ingestNote: vi.fn(),
    deleteAccount: vi.fn(),
    refreshCachedAccounts: vi.fn(),
    syncXhsAuthWithPlaywright: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { name: "Tester", email: "tester@example.com" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/i18n", () => ({
  useLang: () => ({
    t: {
      xhsWorkflowAwaitingAuth: "Queued until auth is ready",
      xhsWorkflowSyncing: "Syncing browser login",
      xhsWorkflowIngesting: "Ingesting queued link",
      xhsWorkflowRefreshing: "Refreshing cached accounts",
      xhsCommandReady: "Ready for the next Xiaohongshu ingest.",
      xhsLoginRequired: "XHS login required",
      xhsLoginPopupBlocked: "Popup blocked",
      xhsSyncLoginSuccess: "Browser login synced",
      xhsSyncLoginFailed: "Sync login failed",
      profileAdded: "Profile added",
      profileDeleted: "Profile deleted",
      profileDeleteFailed: "Delete failed",
      profilesRefreshed: "Profiles refreshed",
      profilesRefreshFailed: "Refresh failed",
      postsIndexed: "posts indexed",
      noAccounts: "No accounts",
      loadingPosts: "Loading posts",
      noPostsYet: "No posts yet",
      selectAccountPrompt: "Select account",
      postAnalysis: "Post analysis",
      updated: "Updated",
      logoutCta: "Log out",
    },
  }),
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: testState.toast,
}));

vi.mock("@/components/AstraSidebar", () => ({
  AstraSidebar: ({
    selectedAccountId,
    workflowState,
  }: {
    selectedAccountId: string | null;
    workflowState: string;
  }) => (
    <div data-testid="sidebar">
      <div data-testid="selected-account">{selectedAccountId ?? "none"}</div>
      <div data-testid="workflow-state">{workflowState}</div>
    </div>
  ),
}));

vi.mock("@/components/CommandBar", () => ({
  CommandBar: ({ onStartAgent }: { onStartAgent: (url: string) => void }) => (
    <button
      data-testid="start-ingest"
      onClick={() => onStartAgent("https://www.xiaohongshu.com/user/profile/tester")}
    >
      start-ingest
    </button>
  ),
}));

vi.mock("@/components/XhsAccessPanel", () => ({
  XhsAccessPanel: ({
    pendingUrl,
    onSyncBrowserLogin,
    onOpenLoginPage,
    authStatus,
  }: {
    pendingUrl?: string | null;
    onSyncBrowserLogin: () => void;
    onOpenLoginPage: () => void;
    authStatus?: { nextAction?: string; canIngest?: boolean };
  }) => (
    <div data-testid="xhs-access-panel">
      <div data-testid="queued-url">{pendingUrl ?? "none"}</div>
      <div data-testid="next-action">{authStatus?.nextAction ?? "unknown"}</div>
      <div data-testid="can-ingest">{String(authStatus?.canIngest ?? false)}</div>
      <button data-testid="open-login" onClick={onOpenLoginPage}>
        open-login
      </button>
      <button data-testid="sync-auth" onClick={onSyncBrowserLogin}>
        sync-auth
      </button>
    </div>
  ),
}));

vi.mock("@/components/NodeRunner", () => ({
  NodeRunner: ({
    isRunning,
    onComplete,
  }: {
    isRunning: boolean;
    onComplete: () => void;
  }) => {
    useEffect(() => {
      if (isRunning) {
        onComplete();
      }
    }, [isRunning, onComplete]);
    return <div data-testid="node-runner">{isRunning ? "running" : "idle"}</div>;
  },
}));

vi.mock("@/components/PostTable", () => ({
  PostTable: () => <div data-testid="post-table" />,
}));

vi.mock("@/components/StrategyDrawer", () => ({
  StrategyDrawer: () => null,
}));

vi.mock("@/components/LangToggle", () => ({
  LangToggle: () => null,
}));

vi.mock("@/components/LoginPanel", () => ({
  LoginPanel: () => <div>login panel</div>,
}));

import {
  fetchAccountNotes,
  fetchAccounts,
  fetchXhsAuthStatus,
  ingestNote,
  refreshCachedAccounts,
  syncXhsAuthWithPlaywright,
} from "@/lib/api";
import Index from "@/pages/Index";

async function waitForAssertion(assertion: () => void, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
    }
  }
}

describe("Index XHS auth loop", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "open").mockImplementation(() => null);
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("queues the URL, syncs browser auth, and auto-retries ingest when cookie auth becomes ready", async () => {
    vi.mocked(fetchAccounts)
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          id: "acc-queued",
          name: "Queued Creator",
          xhsId: "queued_creator",
          platform: "xiaohongshu",
          avatar: "Q",
          postCount: 1,
          profileUrl: "https://www.xiaohongshu.com/user/profile/queued_creator",
        },
      ]);
    vi.mocked(fetchAccountNotes).mockResolvedValue([]);
    vi.mocked(fetchXhsAuthStatus)
      .mockResolvedValueOnce({
        hasToken: false,
        hasCookie: false,
        canIngest: false,
        loginUrl: "https://www.xiaohongshu.com",
        authMode: "none",
        nextAction: "sync",
        authError: {
          code: "XHS_AUTH_REQUIRED",
          message: "Sync browser login first",
          loginUrl: "https://www.xiaohongshu.com",
        },
      })
      .mockResolvedValue({
        hasToken: false,
        hasCookie: true,
        canIngest: true,
        loginUrl: "https://www.xiaohongshu.com",
        authMode: "cookie",
        nextAction: "retry",
      });
    vi.mocked(syncXhsAuthWithPlaywright).mockResolvedValue({
      success: true,
      hasCookie: true,
      message: "Cookie session synced",
    });
    vi.mocked(refreshCachedAccounts).mockResolvedValue({
      totalAccounts: 0,
      refreshedAccounts: 0,
      failedAccounts: 0,
      totalPosts: 0,
      results: [],
    });
    vi.mocked(ingestNote).mockResolvedValue({
      account: {
        id: "acc-queued",
        name: "Queued Creator",
        xhsId: "queued_creator",
        platform: "xiaohongshu",
        avatar: "Q",
        postCount: 1,
        profileUrl: "https://www.xiaohongshu.com/user/profile/queued_creator",
      },
      post: {
        id: "note-1",
        accountId: "acc-queued",
        title: "Queued note",
        content: "Queued note content",
        likes: 10,
        shares: 2,
        comments: 1,
        collects: 1,
        views: 100,
        growthRate: 0.3,
        status: "normal",
        timestamp: new Date().toISOString(),
        history: [1, 2, 3],
        seoKeywords: [],
        url: "https://www.xiaohongshu.com/explore/note-1",
      },
      cachedKey: "xhs:parsed:note-1",
      agentTaskId: null,
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Index />
        </QueryClientProvider>,
      );
    });

    await waitForAssertion(() => {
      expect(container.querySelector("[data-testid='next-action']")?.textContent).toBe("sync");
    });

    const startButton = container.querySelector<HTMLButtonElement>("[data-testid='start-ingest']");
    expect(startButton).not.toBeNull();
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForAssertion(() => {
      expect(container.querySelector("[data-testid='queued-url']")?.textContent).toContain(
        "https://www.xiaohongshu.com/user/profile/tester",
      );
    });
    expect(ingestNote).not.toHaveBeenCalled();

    const syncButton = container.querySelector<HTMLButtonElement>("[data-testid='sync-auth']");
    expect(syncButton).not.toBeNull();
    await act(async () => {
      syncButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForAssertion(() => {
      expect(syncXhsAuthWithPlaywright).toHaveBeenCalledTimes(1);
    });

    await waitForAssertion(() => {
      expect(vi.mocked(ingestNote).mock.calls[0]?.[0]).toEqual({
        url: "https://www.xiaohongshu.com/user/profile/tester",
      });
    });

    await waitForAssertion(() => {
      expect(container.querySelector("[data-testid='selected-account']")?.textContent).toBe("acc-queued");
    });

    expect(testState.toast).toHaveBeenCalledWith(
      "Browser login synced",
      expect.objectContaining({
        description: "Cookie session synced",
      }),
    );
    expect(testState.toast).toHaveBeenCalledWith(
      "Profile added",
      expect.objectContaining({
        description: "Queued note",
      }),
    );
  });
});
