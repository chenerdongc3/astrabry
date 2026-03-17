import { Activity, Users, Bell, Zap } from "lucide-react";
import { MOCK_ACCOUNTS, MOCK_POSTS } from "@/lib/data";

export function AstraSidebar() {
  const alerts = MOCK_POSTS.filter((p) => p.growthRate > 0.5);

  return (
    <aside className="w-56 flex-shrink-0 h-screen border-r border-border bg-card flex flex-col">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary/20 flex items-center justify-center">
            <Activity className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground tracking-tight">Astra</span>
          <span className="text-[10px] font-mono-data text-muted-foreground ml-auto">v0.1</span>
        </div>
      </div>

      {/* Monitored Accounts */}
      <div className="px-3 py-3">
        <div className="flex items-center gap-1.5 px-1 mb-2">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Monitored
          </span>
        </div>
        <div className="space-y-0.5">
          {MOCK_ACCOUNTS.map((acc) => (
            <div
              key={acc.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
            >
              <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center text-xs font-medium text-foreground">
                {acc.avatar}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-foreground truncate">{acc.handle}</div>
                <div className="text-[10px] text-muted-foreground">
                  {acc.postCount} posts · {acc.platform}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      <div className="px-3 py-3 border-t border-border">
        <div className="flex items-center gap-1.5 px-1 mb-2">
          <Bell className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Active Alerts
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
                className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-anomaly/5 border border-anomaly/10"
              >
                <Zap className="h-3 w-3 text-anomaly mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] text-anomaly font-medium">
                    +{(post.growthRate * 100).toFixed(0)}% growth detected
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {post.content.slice(0, 40)}...
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-2 py-2 text-[10px] text-muted-foreground">
            No anomalies detected
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto px-3 py-3 border-t border-border">
        <div className="text-[10px] font-mono-data text-muted-foreground/60">
          Last scan: 2m ago
        </div>
      </div>
    </aside>
  );
}
