import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AstraSidebar } from "@/components/AstraSidebar";
import { CommandBar } from "@/components/CommandBar";
import { NodeRunner } from "@/components/NodeRunner";
import { PostTable } from "@/components/PostTable";
import { StrategyDrawer } from "@/components/StrategyDrawer";
import { LangToggle } from "@/components/LangToggle";
import { LoginPanel } from "@/components/LoginPanel";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { Post } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import {
  fetchAccounts,
  fetchAccountNotes,
  fetchXhsAuthStatus,
  ingestNote,
  deleteAccount,
  refreshCachedAccounts,
  type IngestResult,
} from "@/lib/api";
import { getXhsAuthRequiredInfo, shouldAutoOpenXhsLogin } from "@/lib/xhsAuthRequired";

const XHS_AUTH_TOAST_ID = "xhs-auth-required";
const XHS_AUTH_STATUS_POLL_MS = 3_000;

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
  const [isRunning, setIsRunning] = useState(false);
  const [runnerComplete, setRunnerComplete] = useState(false);
  const [pendingResult, setPendingResult] = useState<IngestResult | null>(null);
  const [authRetryPayload, setAuthRetryPayload] = useState<IngestInput | null>(null);
  const [refreshProgress, setRefreshProgress] = useState(0);
  const ingestStartLockRef = useRef(false);
  const authStatusCheckLockRef = useRef(false);
  const refreshProgressTimerRef = useRef<number | null>(null);

  const resetIngestUiState = useCallback(() => {
    setIsRunning(false);
    setRunnerComplete(false);
    setPendingResult(null);
  }, []);

  const accountsQuery = useQuery({ queryKey: ["xhs", "accounts"], queryFn: fetchAccounts });
  const accounts = accountsQuery.data ?? [];

  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
      return;
    }
    if (selectedAccountId && accounts.every((acc) => acc.id !== selectedAccountId)) {
      setSelectedAccountId(accounts[0]?.id ?? null);
      setSelectedPost(null);
    }
  }, [accounts, selectedAccountId]);

  const postsQuery = useQuery({
    queryKey: ["xhs", "notes", selectedAccountId],
    queryFn: () => fetchAccountNotes(selectedAccountId as string),
    enabled: Boolean(selectedAccountId),
  });
  const posts = postsQuery.data ?? [];

  const alerts = useMemo(() => posts.filter((post) => post.growthRate > 0.35), [posts]);

  const ingestMutation = useMutation({
    mutationFn: ingestNote,
    onSuccess: (data) => {
      setAuthRetryPayload(null);
      setPendingResult(data);
    },
    onError: (error: Error, variables) => {
      const authRequired = getXhsAuthRequiredInfo(error);
      if (authRequired) {
        if (variables?.url) {
          setAuthRetryPayload({
            url: variables.url,
            accountId: variables.accountId,
          });
        }
        const openLoginPage = () =>
          window.open(authRequired.loginUrl, "_blank", "noopener,noreferrer");

        const shouldAutoOpen = shouldAutoOpenXhsLogin(authRequired.loginUrl);
        const autoOpened = shouldAutoOpen ? openLoginPage() !== null : false;

        const fallbackDescription = shouldAutoOpen
          ? autoOpened
            ? t.xhsLoginRedirecting
            : t.xhsLoginPopupBlocked
          : t.xhsLoginAlreadyPrompted;

        toast(t.xhsLoginRequired, {
          id: XHS_AUTH_TOAST_ID,
          description: authRequired.message ?? fallbackDescription,
          action: {
            label: t.xhsLoginOpenManually,
            onClick: openLoginPage,
          },
        });
        resetIngestUiState();
        return;
      }

      const isNetworkError =
        /network|failed to fetch|可达|backend/i.test(error.message);
      toast(isNetworkError ? t.ingestNetworkFailed : t.ingestFailed, {
        description: error.message,
      });
      setAuthRetryPayload(null);
      resetIngestUiState();
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

  const refreshAccountsMutation = useMutation({
    mutationFn: refreshCachedAccounts,
    onMutate: () => {
      setRefreshProgress(6);
      if (refreshProgressTimerRef.current) {
        window.clearInterval(refreshProgressTimerRef.current);
      }
      refreshProgressTimerRef.current = window.setInterval(() => {
        setRefreshProgress((prev) => {
          if (prev >= 92) return prev;
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
    },
  });

  const runIngest = useCallback(
    (input: IngestInput) => {
      if (!input.url.trim() || isRunning || ingestMutation.isPending || ingestStartLockRef.current) {
        return false;
      }
      ingestStartLockRef.current = true;
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
      setAuthRetryPayload(null);
      // Always create/update account by the ingested profile itself.
      // Do not bind new ingest requests to currently selected account id.
      runIngest({ url: nextUrl });
    },
    [runIngest],
  );

  const handleSelectAccount = useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
    setSelectedPost(null);
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

  useEffect(() => {
    if (!runnerComplete || !pendingResult) return;

    const accountId = pendingResult.account.id;
    queryClient.invalidateQueries({ queryKey: ["xhs", "accounts"] });
    queryClient.invalidateQueries({ queryKey: ["xhs", "notes", accountId] });
    setSelectedAccountId(accountId);
    toast(t.profileAdded, {
      description: pendingResult.post.title ?? pendingResult.post.content.slice(0, 60),
    });
    resetIngestUiState();
  }, [pendingResult, queryClient, resetIngestUiState, runnerComplete, t.profileAdded]);

  useEffect(() => {
    if (!authRetryPayload) return;

    let disposed = false;

    const checkAndRetry = async () => {
      if (disposed || authStatusCheckLockRef.current) return;
      authStatusCheckLockRef.current = true;
      try {
        const authStatus = await fetchXhsAuthStatus();
        if (disposed || !authStatus.hasToken) return;

        const started = runIngest(authRetryPayload);
        if (started) {
          setAuthRetryPayload(null);
        }
      } catch {
        // keep polling quietly until token appears or user starts a new ingest.
      } finally {
        authStatusCheckLockRef.current = false;
      }
    };

    void checkAndRetry();
    const intervalId = window.setInterval(() => {
      void checkAndRetry();
    }, XHS_AUTH_STATUS_POLL_MS);
    const onFocus = () => {
      void checkAndRetry();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkAndRetry();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authRetryPayload, runIngest]);

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

  return (
    <div className="relative flex min-h-screen w-full bg-transparent">
      <div className="pointer-events-none absolute -top-24 left-[28%] h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10rem] right-[-5rem] h-72 w-72 rounded-full bg-anomaly/10 blur-3xl" />
      <AstraSidebar
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onSelectAccount={handleSelectAccount}
        onDeleteAccount={handleDeleteAccount}
        onRefreshAccounts={handleRefreshAccounts}
        isRefreshingAccounts={refreshAccountsMutation.isPending}
        refreshProgress={refreshProgress}
        alerts={alerts}
      />

      <main className="relative z-10 flex-1 flex flex-col min-h-screen">
        <header className="px-6 py-4 border-b border-border/70 bg-card/55 backdrop-blur-md">
          <div className="max-w-6xl space-y-3">
            <CommandBar onStartAgent={handleStartAgent} isRunning={isRunning} />
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
