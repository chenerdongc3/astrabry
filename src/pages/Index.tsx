import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AstraSidebar } from "@/components/AstraSidebar";
import { CommandBar } from "@/components/CommandBar";
import { LangToggle } from "@/components/LangToggle";
import { LoginPanel } from "@/components/LoginPanel";
import { NodeRunner } from "@/components/NodeRunner";
import { PostTable } from "@/components/PostTable";
import { StrategyDrawer } from "@/components/StrategyDrawer";
import { XhsAccessPanel } from "@/components/XhsAccessPanel";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  pruneAccountClickTimestamps,
  readAccountClickTimestamps,
  recordAccountClick,
  sortAccountsByClickTime,
  writeAccountClickTimestamps,
} from "@/lib/accountClickOrder";
import { useAuth } from "@/lib/auth";
import {
  deleteAccount,
  fetchAccountNotes,
  fetchAccounts,
  fetchXhsAuthStatus,
  ingestNote,
  refreshCachedAccounts,
  syncXhsAuthWithPlaywright,
  type IngestResult,
  type XhsAuthStatus,
} from "@/lib/api";
import type { MonitoredAccount, Post } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { getXhsAuthRequiredInfo, type XhsWorkflowState } from "@/lib/xhsAuthRequired";

const XHS_AUTH_STATUS_POLL_MS = 3_000;
const DEFAULT_XHS_LOGIN_URL = "https://www.xiaohongshu.com";
const EMPTY_ACCOUNTS: MonitoredAccount[] = [];
const EMPTY_POSTS: Post[] = [];

interface IngestInput {
  url: string;
  accountId?: string;
}

const Index = () => {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const { user, logout } = useAuth();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [workflowState, setWorkflowState] = useState<XhsWorkflowState>("idle");
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runnerComplete, setRunnerComplete] = useState(false);
  const [pendingResult, setPendingResult] = useState<IngestResult | null>(null);
  const [pendingIngestInput, setPendingIngestInput] = useState<IngestInput | null>(null);
  const [refreshProgress, setRefreshProgress] = useState(0);
  const [accountClickTimestamps, setAccountClickTimestamps] = useState<Record<string, number>>(
    () => readAccountClickTimestamps(),
  );
  const [isXhsPanelCollapsed, setIsXhsPanelCollapsed] = useState(false);

  const ingestStartLockRef = useRef(false);
  const refreshProgressTimerRef = useRef<number | null>(null);

  const resetIngestUiState = useCallback(() => {
    setIsRunning(false);
    setRunnerComplete(false);
    setPendingResult(null);
  }, []);

  const accountsQuery = useQuery({
    queryKey: ["xhs", "accounts"],
    queryFn: fetchAccounts,
  });
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const orderedAccounts = useMemo(
    () => sortAccountsByClickTime(accounts, accountClickTimestamps),
    [accountClickTimestamps, accounts],
  );

  const authStatusQuery = useQuery({
    queryKey: ["xhs", "auth-status"],
    queryFn: fetchXhsAuthStatus,
    retry: false,
    staleTime: 2_000,
    refetchInterval: pendingIngestInput ? XHS_AUTH_STATUS_POLL_MS : false,
    refetchOnWindowFocus: Boolean(pendingIngestInput),
  });
  const authStatus = authStatusQuery.data;

  useEffect(() => {
    if (!selectedAccountId && orderedAccounts.length > 0) {
      setSelectedAccountId(orderedAccounts[0].id);
      return;
    }
    if (selectedAccountId && orderedAccounts.every((acc) => acc.id !== selectedAccountId)) {
      setSelectedAccountId(orderedAccounts[0]?.id ?? null);
      setSelectedPost(null);
    }
  }, [orderedAccounts, selectedAccountId]);

  useEffect(() => {
    setAccountClickTimestamps((previous) => pruneAccountClickTimestamps(previous, accounts));
  }, [accounts]);

  useEffect(() => {
    writeAccountClickTimestamps(accountClickTimestamps);
  }, [accountClickTimestamps]);

  const postsQuery = useQuery({
    queryKey: ["xhs", "notes", selectedAccountId],
    queryFn: () => fetchAccountNotes(selectedAccountId as string),
    enabled: Boolean(selectedAccountId),
  });
  const posts = postsQuery.data ?? EMPTY_POSTS;

  const alerts = useMemo(() => posts.filter((post) => post.growthRate > 0.35), [posts]);

  const ingestMutation = useMutation({
    mutationFn: ingestNote,
    onSuccess: (data) => {
      setPendingIngestInput(null);
      setWorkflowError(null);
      setPendingResult(data);
    },
    onError: async (error: Error, variables) => {
      const authRequired = getXhsAuthRequiredInfo(error);
      if (authRequired) {
        if (variables?.url) {
          setPendingIngestInput({
            url: variables.url,
            accountId: variables.accountId,
          });
        }
        setWorkflowState("awaiting_auth");
        setWorkflowError(authRequired.message ?? t.xhsWorkflowAwaitingAuth);
        resetIngestUiState();
        await authStatusQuery.refetch();
        return;
      }

      const isNetworkError = /network|failed to fetch|可达|backend/i.test(error.message);
      setPendingIngestInput(null);
      setWorkflowState("error");
      setWorkflowError(error.message);
      resetIngestUiState();
      toast(isNetworkError ? t.ingestNetworkFailed : t.ingestFailed, {
        description: error.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async (_, accountId) => {
      await queryClient.invalidateQueries({ queryKey: ["xhs", "accounts"] });
      if (selectedAccountId === accountId) {
        setSelectedAccountId(null);
        setSelectedPost(null);
      }
      toast(t.profileDeleted);
    },
    onError: (error: Error) => {
      toast(t.profileDeleteFailed, { description: error.message });
    },
  });

  const syncAuthMutation = useMutation({
    mutationFn: () => syncXhsAuthWithPlaywright(),
    onMutate: () => {
      setWorkflowState("syncing_auth");
      setWorkflowError(null);
    },
    onSuccess: async (result) => {
      await authStatusQuery.refetch();
      toast(t.xhsSyncLoginSuccess, {
        description: result.message,
      });
      if (!pendingIngestInput) {
        setWorkflowState("idle");
      }
    },
    onError: (error: Error) => {
      setWorkflowState("error");
      setWorkflowError(error.message);
      toast(t.xhsSyncLoginFailed, {
        description: error.message,
      });
    },
  });

  const refreshAccountsMutation = useMutation({
    mutationFn: refreshCachedAccounts,
    onMutate: () => {
      setWorkflowState("refreshing");
      setWorkflowError(null);
      setRefreshProgress(6);
      if (refreshProgressTimerRef.current) {
        window.clearInterval(refreshProgressTimerRef.current);
      }
      refreshProgressTimerRef.current = window.setInterval(() => {
        setRefreshProgress((prev) => {
          if (prev >= 92) {
            return prev;
          }
          const step = prev < 40 ? 6 : prev < 70 ? 4 : 2;
          return Math.min(92, prev + step);
        });
      }, 250);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["xhs", "accounts"] });
      if (selectedAccountId) {
        await queryClient.invalidateQueries({ queryKey: ["xhs", "notes", selectedAccountId] });
      }

      if (result.totalAccounts === 0) {
        toast(t.profilesRefreshed, {
          description: t.noAccounts,
        });
        return;
      }

      if (result.failedAccounts > 0) {
        toast(t.profilesRefreshed, {
          description: `${result.refreshedAccounts}/${result.totalAccounts}`,
        });
        return;
      }

      toast(t.profilesRefreshed, {
        description: `${result.totalPosts} ${t.postsIndexed}`,
      });
    },
    onError: (error: Error) => {
      setWorkflowState("error");
      setWorkflowError(error.message);
      toast(t.profilesRefreshFailed, {
        description: error.message,
      });
    },
    onSettled: () => {
      if (refreshProgressTimerRef.current) {
        window.clearInterval(refreshProgressTimerRef.current);
        refreshProgressTimerRef.current = null;
      }
      setRefreshProgress(100);
      window.setTimeout(() => {
        setRefreshProgress(0);
      }, 500);
      setWorkflowState((current) => (current === "refreshing" ? "idle" : current));
    },
  });

  const runIngest = useCallback(
    (input: IngestInput) => {
      if (!input.url.trim() || isRunning || ingestMutation.isPending || ingestStartLockRef.current) {
        return false;
      }

      ingestStartLockRef.current = true;
      setIsXhsPanelCollapsed(false);
      setWorkflowState("ingesting");
      setWorkflowError(null);
      setIsRunning(true);
      setRunnerComplete(false);
      setPendingResult(null);
      ingestMutation.mutate(input, {
        onSettled: () => {
          ingestStartLockRef.current = false;
        },
      });
      return true;
    },
    [ingestMutation, isRunning],
  );

  const handleStartAgent = useCallback(
    (url: string) => {
      const nextUrl = url.trim();
      if (!nextUrl) {
        return;
      }

      setWorkflowError(null);

      if (authStatus && !authStatus.canIngest) {
        setPendingIngestInput({ url: nextUrl });
        setWorkflowState("awaiting_auth");
        return;
      }

      runIngest({ url: nextUrl });
    },
    [authStatus, runIngest],
  );

  const handleSelectAccount = useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
    setSelectedPost(null);
    setAccountClickTimestamps((previous) => recordAccountClick(previous, accountId));
  }, []);

  const handleDeleteAccount = useCallback(
    (accountId: string) => {
      deleteMutation.mutate(accountId);
    },
    [deleteMutation],
  );

  const handleRunnerComplete = useCallback(() => {
    setRunnerComplete(true);
  }, []);

  const handleRefreshAccounts = useCallback(() => {
    if (refreshAccountsMutation.isPending) {
      return;
    }
    refreshAccountsMutation.mutate();
  }, [refreshAccountsMutation]);

  const handleOpenLoginPage = useCallback(() => {
    const loginUrl = authStatus?.loginUrl ?? DEFAULT_XHS_LOGIN_URL;
    const popup = window.open(loginUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      toast(t.xhsLoginRequired, {
        description: t.xhsLoginPopupBlocked,
      });
      return;
    }
    setWorkflowState("awaiting_auth");
    setWorkflowError(null);
  }, [authStatus?.loginUrl, t.xhsLoginPopupBlocked, t.xhsLoginRequired]);

  const handleSyncBrowserLogin = useCallback(() => {
    if (syncAuthMutation.isPending) {
      return;
    }
    syncAuthMutation.mutate();
  }, [syncAuthMutation]);

  useEffect(() => {
    if (!runnerComplete || !pendingResult) {
      return;
    }

    const accountId = pendingResult.account.id;
    void queryClient.invalidateQueries({ queryKey: ["xhs", "accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["xhs", "notes", accountId] });
    setSelectedAccountId(accountId);
    toast(t.profileAdded, {
      description: pendingResult.post.title ?? pendingResult.post.content.slice(0, 60),
    });
    setIsXhsPanelCollapsed(true);
    setWorkflowState("idle");
    setWorkflowError(null);
    resetIngestUiState();
  }, [pendingResult, queryClient, resetIngestUiState, runnerComplete, t.profileAdded]);

  useEffect(() => {
    if (!pendingIngestInput || !authStatus?.canIngest) {
      return;
    }

    const started = runIngest(pendingIngestInput);
    if (started) {
      setPendingIngestInput(null);
    }
  }, [authStatus?.canIngest, pendingIngestInput, runIngest]);

  useEffect(() => {
    if (pendingIngestInput || !authStatus?.canIngest) {
      return;
    }
    if (workflowState === "awaiting_auth" || workflowState === "syncing_auth") {
      setWorkflowState("idle");
      setWorkflowError(null);
    }
  }, [authStatus?.canIngest, pendingIngestInput, workflowState]);

  useEffect(() => {
    return () => {
      if (refreshProgressTimerRef.current) {
        window.clearInterval(refreshProgressTimerRef.current);
        refreshProgressTimerRef.current = null;
      }
    };
  }, []);

  if (!user) {
    return <LoginPanel />;
  }

  const renderPostBoard = () => {
    if (!selectedAccountId) {
      return (
        <div className="border border-dashed border-border/60 rounded-md py-12 text-center text-xs text-muted-foreground">
          {t.selectAccountPrompt}
        </div>
      );
    }

    if (postsQuery.isLoading) {
      return (
        <div className="border border-dashed border-border/60 rounded-md py-12 text-center text-xs text-muted-foreground">
          {t.loadingPosts}
        </div>
      );
    }

    if (posts.length === 0) {
      return (
        <div className="border border-dashed border-border/60 rounded-md py-12 text-center text-xs text-muted-foreground">
          {t.noPostsYet}
        </div>
      );
    }

    return <PostTable posts={posts} onSelectPost={setSelectedPost} />;
  };

  const commandStatusLabel =
    workflowState === "awaiting_auth"
      ? t.xhsWorkflowAwaitingAuth
      : workflowState === "syncing_auth"
        ? t.xhsWorkflowSyncing
        : workflowState === "ingesting"
          ? t.xhsWorkflowIngesting
          : workflowState === "refreshing"
            ? t.xhsWorkflowRefreshing
            : workflowState === "error"
              ? undefined
              : t.xhsCommandReady;

  const panelError =
    workflowState === "error" || workflowState === "awaiting_auth"
      ? workflowError ?? authStatus?.authError?.message ?? null
      : null;

  const canCompactXhsPanel =
    workflowState === "idle" && !pendingIngestInput && !workflowError && Boolean(authStatus?.canIngest);

  useEffect(() => {
    if (!canCompactXhsPanel && isXhsPanelCollapsed) {
      setIsXhsPanelCollapsed(false);
    }
  }, [canCompactXhsPanel, isXhsPanelCollapsed]);

  const handleToggleXhsPanel = useCallback(() => {
    if (!canCompactXhsPanel) {
      return;
    }
    setIsXhsPanelCollapsed((previous) => !previous);
  }, [canCompactXhsPanel]);

  return (
    <div className="relative flex min-h-screen w-full bg-transparent">
      <div className="pointer-events-none absolute -top-24 left-[28%] h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10rem] right-[-5rem] h-72 w-72 rounded-full bg-anomaly/10 blur-3xl" />
      <AstraSidebar
        accounts={orderedAccounts}
        selectedAccountId={selectedAccountId}
        onSelectAccount={handleSelectAccount}
        onDeleteAccount={handleDeleteAccount}
        onRefreshAccounts={handleRefreshAccounts}
        isRefreshingAccounts={refreshAccountsMutation.isPending}
        refreshProgress={refreshProgress}
        alerts={alerts}
        workflowState={workflowState}
      />

      <main className="relative z-10 flex-1 flex flex-col min-h-screen">
        <header className="px-6 py-4 border-b border-border/70 bg-card/55 backdrop-blur-md">
          <div className="max-w-6xl space-y-3">
            <CommandBar
              onStartAgent={handleStartAgent}
              isBusy={workflowState === "ingesting" || workflowState === "syncing_auth"}
              workflowState={workflowState}
              statusLabel={commandStatusLabel}
              externalError={workflowState === "error" ? workflowError : null}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <LangToggle />
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs font-semibold text-foreground">{user.name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono-data">{user.email}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={logout}
                  className="h-8 text-xs uppercase tracking-wide"
                >
                  {t.logoutCta}
                </Button>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 px-6 py-6">
          <div className="max-w-6xl space-y-5">
            <XhsAccessPanel
              authStatus={authStatus as XhsAuthStatus | undefined}
              workflowState={workflowState}
              pendingUrl={pendingIngestInput?.url}
              errorMessage={panelError}
              isCollapsed={isXhsPanelCollapsed && canCompactXhsPanel}
              canCollapse={canCompactXhsPanel}
              onToggleCollapsed={handleToggleXhsPanel}
              onOpenLoginPage={handleOpenLoginPage}
              onSyncBrowserLogin={handleSyncBrowserLogin}
              isSyncing={syncAuthMutation.isPending}
            />

            <NodeRunner isRunning={isRunning} onComplete={handleRunnerComplete} />

            <div className="flex items-baseline justify-between">
              <h1 className="text-sm font-semibold tracking-wide text-foreground">{t.postAnalysis}</h1>
              <span className="text-[10px] font-mono-data text-muted-foreground">
                {t.updated} {new Date().toLocaleTimeString()}
              </span>
            </div>
            {renderPostBoard()}
          </div>
        </div>
      </main>

      <StrategyDrawer post={selectedPost} onClose={() => setSelectedPost(null)} />
    </div>
  );
};

export default Index;
