import { X, Zap, Heart, Repeat, TrendingUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { Post } from "@/lib/data";
import { useLang } from "@/lib/i18n";

interface StrategyDrawerProps {
  post: Post | null;
  onClose: () => void;
}

export function StrategyDrawer({ post, onClose }: StrategyDrawerProps) {
  const { t } = useLang();

  if (!post) return null;

  const chartData = post.history.map((val, i) => ({ time: `T${i}`, value: val }));
  const strategyKey = `strategy${post.status.charAt(0).toUpperCase() + post.status.slice(1)}` as
    | "strategyViral"
    | "strategyNormal"
    | "strategyLow";
  const strategy = t[strategyKey];
  const isAnomaly = post.growthRate > 0.2;

  return (
    <AnimatePresence>
      {post && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40"
          />

          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
            className="fixed top-0 right-0 h-full w-full max-w-[420px] bg-card border-l border-border z-50 flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-border flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  {isAnomaly && (
                    <span className="flex items-center gap-1 text-xs font-mono-data text-anomaly font-medium">
                      <Zap className="h-3 w-3" />
                      {t.anomalyDetected}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground leading-snug line-clamp-3">
                  {post.content}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-muted text-muted-foreground ml-3 flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Metrics */}
            <div className="px-5 py-3 border-b border-border grid grid-cols-3 gap-3">
              <MetricCard icon={Heart} label={t.likes} value={post.likes.toLocaleString()} />
              <MetricCard icon={Repeat} label={t.shares} value={post.shares.toLocaleString()} />
              <MetricCard
                icon={TrendingUp}
                label={t.growth}
                value={`+${(post.growthRate * 100).toFixed(0)}%`}
                highlight={isAnomaly}
              />
            </div>

            {/* Chart */}
            <div className="px-5 py-4 border-b border-border">
              <span className="text-xs font-mono-data text-muted-foreground mb-2 block">
                {t.engagementTimeline}
              </span>
              <div className="h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorGrowth" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor={isAnomaly ? "hsl(38, 92%, 50%)" : "hsl(142, 71%, 45%)"}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor={isAnomaly ? "hsl(38, 92%, 50%)" : "hsl(142, 71%, 45%)"}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" hide />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(222, 47%, 7%)",
                        border: "1px solid hsl(217, 19%, 14%)",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                      labelStyle={{ color: "hsl(215, 16%, 47%)" }}
                      itemStyle={{ color: "hsl(210, 40%, 93%)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={isAnomaly ? "hsl(38, 92%, 50%)" : "hsl(142, 71%, 45%)"}
                      strokeWidth={2}
                      fill="url(#colorGrowth)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* AI Strategy */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-5 rounded-md bg-primary/20 flex items-center justify-center">
                  <Zap className="h-3 w-3 text-primary" />
                </div>
                <span className="text-xs font-medium text-foreground">{t.aiStrategist}</span>
              </div>

              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="text-xs font-mono-data text-muted-foreground mb-1.5">
                    {t.whyPerformed}
                  </h4>
                  <p className="text-foreground/80 leading-relaxed text-xs">
                    {strategy.why}
                  </p>
                </div>

                <div>
                  <h4 className="text-xs font-mono-data text-muted-foreground mb-2">
                    {t.suggestedMoves}
                  </h4>
                  <div className="space-y-2">
                    {strategy.ideas.map((idea, i) => (
                      <div
                        key={i}
                        className="flex gap-2 p-2.5 rounded-md bg-muted/50 border border-border"
                      >
                        <span className="text-xs font-mono-data text-muted-foreground flex-shrink-0">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-xs text-foreground/80 leading-relaxed">
                          {idea}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="text-center">
      <Icon className={`h-3.5 w-3.5 mx-auto mb-1 ${highlight ? "text-anomaly" : "text-muted-foreground"}`} />
      <div className={`text-sm font-mono-data font-medium ${highlight ? "text-anomaly" : "text-foreground"}`}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
