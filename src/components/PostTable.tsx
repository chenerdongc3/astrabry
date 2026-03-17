import { useState } from "react";
import { Heart, Repeat, Zap, ArrowUpDown } from "lucide-react";
import type { Post } from "@/lib/data";
import { useLang } from "@/lib/i18n";

interface PostTableProps {
  posts: Post[];
  onSelectPost: (post: Post) => void;
}

type SortKey = "likes" | "shares" | "growthRate";

const STATUS_KEYS = ["all", "viral", "normal", "low"] as const;

export function PostTable({ posts, onSelectPost }: PostTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("growthRate");
  const [sortAsc, setSortAsc] = useState(false);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_KEYS)[number]>("all");
  const { t } = useLang();

  const statusLabels: Record<string, string> = {
    all: t.all,
    viral: t.viral,
    normal: t.normal,
    low: t.low,
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const filtered = posts.filter(
    (p) => statusFilter === "all" || p.status === statusFilter
  );

  const sorted = [...filtered].sort((a, b) => {
    const mult = sortAsc ? 1 : -1;
    return (a[sortKey] - b[sortKey]) * mult;
  });

  const formatNumber = (n: number) => {
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return n.toString();
  };

  const isAnomaly = (post: Post) => post.growthRate > 0.2;

  return (
    <div className="surface-card rounded-md overflow-hidden">
      {/* Filter bar */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-xs font-mono-data text-muted-foreground">
          {sorted.length} {t.postsIndexed}
        </span>
        <div className="flex gap-1">
          {STATUS_KEYS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                statusFilter === f
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {statusLabels[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-[45%]">
                {t.post}
              </th>
              <SortHeader label={t.likes} sortKey="likes" currentSort={sortKey} asc={sortAsc} onSort={handleSort} />
              <SortHeader label={t.shares} sortKey="shares" currentSort={sortKey} asc={sortAsc} onSort={handleSort} />
              <SortHeader label={t.growth} sortKey="growthRate" currentSort={sortKey} asc={sortAsc} onSort={handleSort} />
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                {t.status}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((post) => (
              <tr
                key={post.id}
                onClick={() => onSelectPost(post)}
                className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-secondary/40 ${
                  isAnomaly(post) ? "border-l-2 border-l-anomaly" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    {isAnomaly(post) && (
                      <span className="relative flex h-2 w-2 mt-1.5 flex-shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-anomaly opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-anomaly" />
                      </span>
                    )}
                    <span className="text-foreground leading-snug line-clamp-2">
                      {post.content}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5 font-mono-data text-xs">
                    <Heart className="h-3 w-3 text-muted-foreground" />
                    {formatNumber(post.likes)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5 font-mono-data text-xs">
                    <Repeat className="h-3 w-3 text-muted-foreground" />
                    {formatNumber(post.shares)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`font-mono-data text-xs font-medium ${
                      isAnomaly(post) ? "text-anomaly" : post.growthRate > 0.1 ? "text-success" : "text-muted-foreground"
                    }`}
                  >
                    +{(post.growthRate * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={post.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  asc,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
}) {
  const active = currentSort === sortKey;
  return (
    <th className="text-left px-4 py-2.5">
      <button
        onClick={() => onSort(sortKey)}
        className={`flex items-center gap-1 text-xs font-medium transition-colors ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}

function StatusBadge({ status }: { status: Post["status"] }) {
  const { t } = useLang();
  const config = {
    viral: "bg-anomaly/15 text-anomaly border-anomaly/30",
    normal: "bg-success/15 text-success border-success/30",
    low: "bg-muted text-muted-foreground border-border",
  };
  const labels: Record<string, string> = {
    viral: t.viral,
    normal: t.normal,
    low: t.low,
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${config[status]}`}
    >
      {status === "viral" && <Zap className="h-3 w-3 mr-1" />}
      {labels[status]}
    </span>
  );
}
