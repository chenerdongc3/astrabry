import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const testState = vi.hoisted(() => ({
  ingestNote: vi.fn(),
  deleteAccount: vi.fn(),
  refreshCachedAccounts: vi.fn(),
  fetchXhsAuthStatus: vi.fn(),
  toast: vi.fn(),
  ingestError: null as Error | null,
  queryClient: {
    invalidateQueries: vi.fn(),
  },
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
    fetchAccounts: vi.fn(),
    fetchAccountNotes: vi.fn(),
    fetchXhsAuthStatus: testState.fetchXhsAuthStatus,
    ingestNote: testState.ingestNote,
    deleteAccount: testState.deleteAccount,
    refreshCachedAccounts: testState.refreshCachedAccounts,
    ApiError,
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => testState.queryClient,
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (Array.isArray(queryKey) && queryKey[1] === "accounts") {
      return { data: [{ id: "acc-1" }], isLoading: false };
    }
    return { data: [], isLoading: false };
  },
  useMutation: (options: {
    mutationFn?: unknown;
    onError?: (error: Error) => void;
  }) => {
    if (options.mutationFn === testState.ingestNote) {
      return {
        mutate: (variables: { url: string; accountId?: string }) => {
          const error = testState.ingestError ?? new Error("Missing ingest error for test");
          options.onError?.(error, variables);
        },
      };
    }

    return {
      mutate: vi.fn(),
    };
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { name: "Tester", email: "tester@example.com" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/i18n", () => ({
  useLang: () => ({
    t: {
      xhsLoginRequired: "XHS login required",
      xhsLoginRedirecting: "Redirecting to Xiaohongshu login...",
      ingestFailed: "Ingest failed",
      ingestNetworkFailed: "Network failed",
      profileAdded: "Profile added",
      profileDeleted: "Profile deleted",
      profileDeleteFailed: "Delete failed",
      logoutCta: "Log out",
      postAnalysis: "Post Analysis",
      updated: "Updated",
      selectAccountPrompt: "Select account",
      loadingPosts: "Loading",
      noPostsYet: "No posts",
    },
  }),
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: testState.toast,
}));

vi.mock("@/components/AstraSidebar", () => ({
  AstraSidebar: () => <div data-testid="sidebar" />,
}));

vi.mock("@/components/CommandBar", () => ({
  CommandBar: ({ onStartAgent }: { onStartAgent: (url: string) => void }) => (
    <button data-testid="start-ingest" onClick={() => onStartAgent("https://example.com/profile")}>start-ingest</button>
  ),
}));

vi.mock("@/components/NodeRunner", () => ({
  NodeRunner: () => <div data-testid="node-runner" />,
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

import { ApiError } from "@/lib/api";
import Index from "@/pages/Index";

describe("Index ingest 401 handling", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    testState.ingestError = null;
    testState.fetchXhsAuthStatus.mockResolvedValue({
      hasToken: false,
      loginUrl: "https://www.xiaohongshu.com",
    });

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

  const renderPage = () => {
    act(() => {
      root.render(<Index />);
    });
  };

  const clickStartIngest = () => {
    const startButton = container.querySelector<HTMLButtonElement>("[data-testid='start-ingest']");
    expect(startButton).not.toBeNull();

    act(() => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("opens login_url and shows backend message for XHS_AUTH_REQUIRED", () => {
    testState.ingestError = new ApiError("Unauthorized", 401, {
      code: "XHS_AUTH_REQUIRED",
      login_url: "https://www.xiaohongshu.com/login?from=test",
      message: "Token missing, please login",
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderPage();
    clickStartIngest();

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.xiaohongshu.com/login?from=test",
      "_blank",
      "noopener,noreferrer",
    );
    expect(testState.toast).toHaveBeenCalledWith(
      "XHS login required",
      expect.objectContaining({
        id: "xhs-auth-required",
        description: "Token missing, please login",
        action: expect.objectContaining({
          onClick: expect.any(Function),
        }),
      }),
    );
    expect(testState.toast).not.toHaveBeenCalledWith("Ingest failed", expect.anything());
  });

  it("uses default login URL and keeps description undefined when fallback text is unavailable", () => {
    testState.ingestError = new ApiError("Unauthorized", 401, {
      code: "XHS_AUTH_REQUIRED",
      login_url: "   ",
      message: "   ",
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderPage();
    clickStartIngest();

    expect(openSpy).toHaveBeenCalledWith(
      "https://www.xiaohongshu.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(testState.toast).toHaveBeenCalledWith(
      "XHS login required",
      expect.objectContaining({
        id: "xhs-auth-required",
        action: expect.objectContaining({
          onClick: expect.any(Function),
        }),
      }),
    );

    const [, toastOptions] = testState.toast.mock.calls.at(-1) as [string, { description?: string }];
    expect(toastOptions.description).toBeUndefined();
  });
});
