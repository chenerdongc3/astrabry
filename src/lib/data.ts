export interface Post {
  id: string;
  content: string;
  likes: number;
  shares: number;
  growthRate: number;
  status: 'viral' | 'normal' | 'low';
  timestamp: string;
  history: number[];
}

export interface MonitoredAccount {
  id: string;
  handle: string;
  platform: string;
  avatar: string;
  postCount: number;
}

export const MOCK_POSTS: Post[] = [
  {
    id: "post-001",
    content: "Just shipped v2.0 of our API — 10x faster inference with zero cold starts.",
    likes: 14200,
    shares: 3840,
    growthRate: 0.52,
    status: "viral",
    timestamp: "2026-03-17T08:14:00Z",
    history: [120, 340, 890, 2100, 5400, 9200, 14200],
  },
  {
    id: "post-002",
    content: "Thread: Why we migrated from REST to tRPC — and what broke along the way.",
    likes: 8700,
    shares: 2100,
    growthRate: 0.31,
    status: "viral",
    timestamp: "2026-03-16T19:30:00Z",
    history: [200, 600, 1400, 3200, 5800, 7600, 8700],
  },
  {
    id: "post-003",
    content: "Hot take: Most 'AI agents' are just glorified if-else chains with an LLM wrapper.",
    likes: 6300,
    shares: 1850,
    growthRate: 0.25,
    status: "viral",
    timestamp: "2026-03-16T14:05:00Z",
    history: [80, 250, 700, 1800, 3500, 5100, 6300],
  },
  {
    id: "post-004",
    content: "New blog post: Optimizing Postgres queries for sub-10ms p99 latency at scale.",
    likes: 3200,
    shares: 890,
    growthRate: 0.12,
    status: "normal",
    timestamp: "2026-03-15T22:10:00Z",
    history: [150, 400, 800, 1400, 2100, 2800, 3200],
  },
  {
    id: "post-005",
    content: "Hiring: Senior infra engineer. Remote, async-first, competitive comp. DM me.",
    likes: 1800,
    shares: 420,
    growthRate: 0.08,
    status: "normal",
    timestamp: "2026-03-15T16:45:00Z",
    history: [90, 200, 450, 800, 1200, 1500, 1800],
  },
  {
    id: "post-006",
    content: "Attended a meetup on WebAssembly runtimes. Takeaway: still not ready for prod.",
    likes: 640,
    shares: 120,
    growthRate: 0.03,
    status: "low",
    timestamp: "2026-03-15T10:20:00Z",
    history: [40, 90, 180, 300, 420, 540, 640],
  },
  {
    id: "post-007",
    content: "Unpopular opinion: TypeScript enums are fine. Stop overcomplicating unions.",
    likes: 4500,
    shares: 1100,
    growthRate: 0.18,
    status: "normal",
    timestamp: "2026-03-14T20:00:00Z",
    history: [100, 350, 900, 1800, 2900, 3800, 4500],
  },
  {
    id: "post-008",
    content: "Our open-source monitoring tool just hit 10k GitHub stars. Thank you!",
    likes: 920,
    shares: 210,
    growthRate: 0.05,
    status: "low",
    timestamp: "2026-03-14T12:30:00Z",
    history: [50, 120, 250, 420, 600, 780, 920],
  },
];

export const MOCK_ACCOUNTS: MonitoredAccount[] = [
  { id: "acc-1", handle: "@eng_sarah", platform: "X", avatar: "S", postCount: 142 },
  { id: "acc-2", handle: "@devops_kai", platform: "X", avatar: "K", postCount: 89 },
  { id: "acc-3", handle: "@ml_priya", platform: "LinkedIn", avatar: "P", postCount: 67 },
];

export const AGENT_STEPS = [
  { node: "Scraper", message: "Launching headless browser...", duration: 1200 },
  { node: "Parser", message: "Extracting post metrics (Likes, Shares)...", duration: 900 },
  { node: "Analyzer", message: "Comparing with historical baseline...", duration: 1100 },
  { node: "Strategist", message: "Generating content suggestions...", duration: 800 },
];
