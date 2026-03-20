export interface Post {
  accountId: string;
  id: string;
  title?: string;
  content: string;
  likes: number;
  shares: number;
  comments: number;
  collects: number;
  views: number;
  growthRate: number;
  status: "viral" | "normal" | "low";
  timestamp: string;
  history: number[];
  seoKeywords?: string[];
  url?: string | null;
}

export interface MonitoredAccount {
  id: string;
  name: string;
  xhsId: string;
  platform: string;
  avatar: string;
  postCount: number;
  profileUrl?: string | null;
}

export const AGENT_STEPS = [
  { node: "Scraper", message: "Launching headless browser...", duration: 1200 },
  { node: "Parser", message: "Extracting post metrics (Likes, Shares)...", duration: 900 },
  { node: "Analyzer", message: "Comparing with historical baseline...", duration: 1100 },
  { node: "Strategist", message: "Generating content suggestions...", duration: 800 },
];
