import { createContext, useContext, useState, ReactNode } from "react";

export type Lang = "en" | "zh";

const t = {
  en: {
    appVersion: "v0.1",
    monitored: "Monitored",
    activeAlerts: "Active Alerts",
    noAnomalies: "No anomalies detected",
    lastScan: "Last scan: 2m ago",
    posts: "posts",
    pasteUrl: "Paste profile URL to begin analysis...",
    startAgent: "Start Agent",
    running: "Running...",
    agentLog: "Agent Execution Log",
    postAnalysis: "Post Analysis",
    updated: "Updated",
    postsIndexed: "posts indexed",
    all: "All",
    viral: "Viral",
    normal: "Normal",
    low: "Low",
    post: "Post",
    likes: "Likes",
    shares: "Shares",
    growth: "Growth",
    status: "Status",
    pasteToBegin: "Paste a profile URL above to begin.",
    anomalyDetected: "Anomaly Detected",
    engagementTimeline: "Engagement Timeline",
    aiStrategist: "AI Strategist Analysis",
    whyPerformed: "WHY IT PERFORMED",
    suggestedMoves: "SUGGESTED NEXT MOVES",
    growthDetected: "growth detected",
    scraper: "Launching headless browser...",
    parser: "Extracting post metrics (Likes, Shares)...",
    analyzer: "Comparing with historical baseline...",
    strategist: "Generating content suggestions...",
    strategyViral: {
      why: "This post triggered high engagement due to a combination of **contrarian framing**, **technical credibility**, and **timing** (posted during peak developer hours UTC). The content-to-engagement ratio suggests algorithmic amplification kicked in after the first 200 shares.",
      ideas: [
        "Follow-up thread: Deep-dive into the technical details with benchmarks and code snippets",
        "Create a comparison post: 'Before vs After' with real metrics from production",
        "Poll the audience: Ask what feature they'd want next — drives replies and algorithmic reach",
      ],
    },
    strategyNormal: {
      why: "Solid organic reach with steady growth. The post performed within expected parameters for this account's baseline. Engagement peaked in the first 4 hours.",
      ideas: [
        "Repurpose as a LinkedIn article with expanded context and data tables",
        "Create a visual infographic summarizing key points for higher share potential",
        "Tag relevant industry voices to expand reach into adjacent networks",
      ],
    },
    strategyLow: {
      why: "Below-baseline performance. Likely factors: suboptimal posting time, low emotional valence, or topic saturation in the feed.",
      ideas: [
        "Reframe with a stronger hook — lead with an unexpected metric or bold claim",
        "Test posting the same content at a different time slot (early morning or late evening)",
        "Add a visual asset — posts with images see 2.3x higher engagement on average",
      ],
    },
  },
  zh: {
    appVersion: "v0.1",
    monitored: "监控账号",
    activeAlerts: "活跃警报",
    noAnomalies: "未检测到异常",
    lastScan: "上次扫描：2分钟前",
    posts: "篇帖子",
    pasteUrl: "粘贴个人主页链接以开始分析...",
    startAgent: "启动代理",
    running: "运行中...",
    agentLog: "代理执行日志",
    postAnalysis: "帖子分析",
    updated: "更新于",
    postsIndexed: "篇帖子已索引",
    all: "全部",
    viral: "爆款",
    normal: "正常",
    low: "低迷",
    post: "帖子",
    likes: "点赞",
    shares: "转发",
    growth: "增长",
    status: "状态",
    pasteToBegin: "在上方粘贴个人主页链接以开始。",
    anomalyDetected: "检测到异常",
    engagementTimeline: "互动趋势",
    aiStrategist: "AI 策略分析",
    whyPerformed: "表现原因",
    suggestedMoves: "建议下一步",
    growthDetected: "增长检测",
    scraper: "正在启动无头浏览器...",
    parser: "正在提取帖子指标（点赞、转发）...",
    analyzer: "正在与历史基准进行对比...",
    strategist: "正在生成内容建议...",
    strategyViral: {
      why: "该帖子因**反直觉框架**、**技术可信度**和**发布时机**（在UTC开发者高峰时段发布）的组合而触发了高互动。内容与互动比表明，在前200次转发后，算法推荐开始生效。",
      ideas: [
        "后续话题：深入技术细节，附上基准测试和代码片段",
        "创建对比帖：用生产环境的真实数据展示'前后对比'",
        "发起投票：询问用户最想要什么功能——提升回复量和算法触达",
      ],
    },
    strategyNormal: {
      why: "稳定的自然触达和持续增长。该帖子的表现在此账号的基准参数范围内。互动在前4小时内达到峰值。",
      ideas: [
        "重新编辑为领英长文，添加更多背景和数据表格",
        "制作视觉信息图，总结关键要点以提高分享潜力",
        "标记相关行业意见领袖，扩展到相邻网络",
      ],
    },
    strategyLow: {
      why: "低于基准的表现。可能原因：发布时间不佳、情感效价低或话题在信息流中已饱和。",
      ideas: [
        "用更强的开头重新包装——以意想不到的数据或大胆声明引导",
        "测试在不同时间段（清晨或深夜）发布相同内容",
        "添加视觉素材——带图片的帖子平均互动率高2.3倍",
      ],
    },
  },
} as const;

export type Translations = typeof t.en;

interface LangContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

const LangContext = createContext<LangContextType>({
  lang: "en",
  setLang: () => {},
  t: t.en,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");
  return (
    <LangContext.Provider value={{ lang, setLang, t: t[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
