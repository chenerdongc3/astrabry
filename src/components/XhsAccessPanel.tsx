import { ChevronsUpDown, Cookie, ExternalLink, KeyRound, Link2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { XhsAuthStatus } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import type { XhsWorkflowState } from "@/lib/xhsAuthRequired";

interface XhsAccessPanelProps {
  authStatus?: XhsAuthStatus;
  workflowState: XhsWorkflowState;
  pendingUrl?: string | null;
  errorMessage?: string | null;
  isCollapsed?: boolean;
  canCollapse?: boolean;
  onToggleCollapsed?: () => void;
  onOpenLoginPage: () => void;
  onSyncBrowserLogin: () => void;
  isSyncing: boolean;
}

export function XhsAccessPanel({
  authStatus,
  workflowState,
  pendingUrl,
  errorMessage,
  isCollapsed = false,
  canCollapse = false,
  onToggleCollapsed,
  onOpenLoginPage,
  onSyncBrowserLogin,
  isSyncing,
}: XhsAccessPanelProps) {
  const { t } = useLang();
  const showCompactView = isCollapsed && canCollapse && Boolean(onToggleCollapsed);

  const authIsReady = authStatus?.canIngest ?? false;
  const authSourceLabel =
    authStatus?.authMode === "token"
      ? t.xhsAuthModeToken
      : authStatus?.authMode === "cookie"
        ? t.xhsAuthModeCookie
        : t.xhsAuthModeNone;

  const authSummary = authIsReady
    ? authStatus?.authMode === "token"
      ? t.xhsAccessTokenSession
      : t.xhsAccessBrowserSession
    : t.xhsAccessNeedsLogin;
  const AuthSourceIcon =
    authStatus?.authMode === "token"
      ? KeyRound
      : authStatus?.authMode === "cookie"
        ? Cookie
        : ShieldAlert;

  const workflowSummary =
    workflowState === "awaiting_auth"
      ? t.xhsWorkflowAwaitingAuth
      : workflowState === "syncing_auth"
        ? t.xhsWorkflowSyncing
        : workflowState === "ingesting"
          ? t.xhsWorkflowIngesting
          : workflowState === "refreshing"
            ? t.xhsWorkflowRefreshing
            : workflowState === "error"
              ? t.xhsWorkflowError
              : t.xhsWorkflowIdle;

  const nextActionSummary =
    authStatus?.nextAction === "sync"
      ? t.xhsNextActionSync
      : authStatus?.nextAction === "retry"
        ? t.xhsNextActionRetry
        : t.xhsNextActionLogin;

  if (showCompactView) {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleCollapsed}
          className="h-10 rounded-full border-success/35 bg-card/70 px-3 text-xs text-success shadow-[0_16px_40px_rgba(3,10,24,0.24)] backdrop-blur-xl"
          aria-label={t.xhsPanelExpand}
          title={t.xhsPanelExpand}
        >
          <ShieldCheck className="h-4 w-4" />
          <span>{t.xhsReadyState}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/65 p-4 shadow-[0_24px_80px_rgba(3,10,24,0.28)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                authIsReady
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-anomaly/30 bg-anomaly/10 text-anomaly"
              }`}
            >
              {authIsReady ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              {authIsReady ? t.xhsReadyState : t.xhsAccessNeedsLogin}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/35 px-2.5 py-1 text-[11px] text-muted-foreground">
              <AuthSourceIcon className="h-3.5 w-3.5" />
              {t.xhsAuthSource}: {authSourceLabel}
            </span>
          </div>

          <div>
            <h2 className="text-sm font-semibold tracking-wide text-foreground">{t.xhsAccessTitle}</h2>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-muted-foreground">
              {t.xhsAccessSubtitle}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard label={authStatus ? t.xhsAuthSource : t.xhsAuthChecking} value={authSummary} />
            <InfoCard label={nextActionSummary} value={workflowSummary} />
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[240px]">
          {canCollapse && onToggleCollapsed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onToggleCollapsed}
              className="h-8 justify-center gap-2 text-xs text-muted-foreground"
              aria-label={t.xhsPanelCollapse}
              title={t.xhsPanelCollapse}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
              {t.xhsPanelCollapse}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={authStatus?.nextAction === "login" ? "default" : "outline"}
            onClick={onOpenLoginPage}
            className="justify-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            {t.xhsLoginOpenManually}
          </Button>
          <Button
            type="button"
            variant={authStatus?.nextAction === "sync" ? "default" : "secondary"}
            onClick={onSyncBrowserLogin}
            disabled={isSyncing}
            className="justify-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? t.xhsSyncingBrowserLogin : t.xhsSyncBrowserLogin}
          </Button>
        </div>
      </div>

      {pendingUrl ? (
        <div className="mt-4 rounded-xl border border-border/70 bg-background/35 p-3">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            {t.xhsQueuedUrl}
          </div>
          <div className="break-all font-mono-data text-xs text-foreground/85">{pendingUrl}</div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mt-4 rounded-xl border border-anomaly/35 bg-anomaly/10 px-3 py-2 text-xs leading-6 text-anomaly">
          {errorMessage}
        </div>
      ) : null}
    </section>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}
