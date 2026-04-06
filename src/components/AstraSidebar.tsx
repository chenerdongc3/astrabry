import { Users, Bell, Zap, Trash2, ExternalLink, RefreshCw } from "lucide-react";
import type { MonitoredAccount, Post } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import type { XhsWorkflowState } from "@/lib/xhsAuthRequired";
import logo from "@/img/Astra.png";

interface AstraSidebarProps {
  accounts: MonitoredAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  onDeleteAccount: (accountId: string) => void;
  onRefreshAccounts: () => void;
  isRefreshingAccounts?: boolean;
  refreshProgress?: number;
  alerts?: Post[];
  workflowState: XhsWorkflowState;
}

export function AstraSidebar({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onDeleteAccount,
  onRefreshAccounts,
  isRefreshingAccounts = false,
  refreshProgress = 0,
  alerts = [],
  workflowState,
}: AstraSidebarProps) {
  const { t } = useLang();
  const { user } = useAuth();
  const workflowLabel =
    workflowState === "awaiting_auth"
      ? t.xhsStatusLabelAwaitingAuth
      : workflowState === "syncing_auth"
        ? t.xhsStatusLabelSyncingAuth
        : workflowState === "ingesting"
          ? t.xhsStatusLabelIngesting
          : workflowState === "refreshing"
            ? t.xhsStatusLabelRefreshing
            : workflowState === "error"
              ? t.xhsStatusLabelError
              : t.xhsStatusLabelIdle;
  const workflowTone =
    workflowState === "error"
      ? "text-anomaly border-anomaly/30 bg-anomaly/10"
      : workflowState === "awaiting_auth" || workflowState === "syncing_auth"
        ? "text-primary border-primary/30 bg-primary/10"
        : workflowState === "ingesting" || workflowState === "refreshing"
          ? "text-success border-success/30 bg-success/10"
          : "text-muted-foreground border-border/70 bg-card/50";

  return (
    <aside className="w-64 flex-shrink-0 min-h-screen border-r border-border/80 bg-sidebar/90 panel-grid backdrop-blur-xl flex flex-col">
      <div className="px-4 py-4 border-b border-border/70">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Astra Logo" className="h-8 w-auto" />
            <div>
              <span className="text-sm font-semibold text-foreground tracking-tight">Astra</span>
              <div className="text-[10px] text-muted-foreground uppercase tracking-[0.22em]">Command Center</div>
            </div>
          </div>
          <button
            type="button"
            aria-label={t.refreshAccounts}
            title={t.refreshAccounts}
            disabled={isRefreshingAccounts}
            onClick={onRefreshAccounts}
            className="h-8 w-8 rounded-md border border-border/70 bg-card/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingAccounts ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t.xhsAccessTitle}
          </span>
          <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${workflowTone}`}>
            {workflowLabel}
          </span>
        </div>
        {(isRefreshingAccounts || refreshProgress > 0) && (
          <div className="mt-2">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${Math.max(3, Math.min(100, refreshProgress))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-3">
        <div className="flex items-center gap-1.5 px-1 mb-2">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {t.monitored}
          </span>
        </div>
        {accounts.length === 0 ? (
          <div className="px-2 py-6 text-[11px] text-muted-foreground/80">{t.noAccounts}</div>
        ) : (
          <div className="space-y-0.5">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-200 ${
                  acc.id === selectedAccountId
                    ? "bg-primary/12 text-foreground border border-primary/35 shadow-[0_0_0_1px_rgba(20,217,235,0.12)]"
                    : "border border-transparent hover:bg-muted/45 hover:border-border/70"
                }`}
                onClick={() => onSelectAccount(acc.id)}
              >
                <div className="h-7 w-7 rounded-md bg-muted/90 flex items-center justify-center text-xs font-medium text-foreground">
                  {acc.avatar}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-xs text-foreground truncate">
                    <span className="truncate">{acc.name}</span>
                    {acc.profileUrl && (
                      <a
                        href={acc.profileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <span>
                      {t.xhsIdLabel} {acc.xhsId}
                    </span>
                    <span className="text-border">•</span>
                    <span>
                      {acc.postCount} {t.posts}
                    </span>
                  </div>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(t.removeAccountConfirm)) onDeleteAccount(acc.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-3 border-t border-border/70">
        <div className="flex items-center gap-1.5 px-1 mb-2">
          <Bell className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {t.activeAlerts}
          </span>
          {alerts.length > 0 && (
            <span className="ml-auto h-4 min-w-[16px] px-1 rounded-md bg-anomaly/20 text-anomaly text-[10px] font-mono-data flex items-center justify-center">
              {alerts.length}
            </span>
          )}
        </div>
        {alerts.length > 0 ? (
          <div className="space-y-1">
            {alerts.map((post) => (
              <div
                key={post.id}
                className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-anomaly/10 border border-anomaly/30"
              >
                <Zap className="h-3 w-3 text-anomaly mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] text-anomaly font-medium">
                    +{(post.growthRate * 100).toFixed(0)}% {t.growthDetected}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {post.content.slice(0, 40)}...
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-2 py-2 text-[10px] text-muted-foreground">{t.noAnomalies}</div>
        )}
      </div>

      <div className="mt-auto px-3 py-3 border-t border-border/70 bg-gradient-to-t from-card to-transparent">
        <div className="text-[10px] font-mono-data text-muted-foreground/60">{t.lastScan}</div>
        {user && (
          <div className="text-[10px] text-muted-foreground mt-1">
            {t.sessionOwner} {user.name}
          </div>
        )}
      </div>
    </aside>
  );
}
