import { useState, useCallback } from "react";
import { AstraSidebar } from "@/components/AstraSidebar";
import { CommandBar } from "@/components/CommandBar";
import { NodeRunner } from "@/components/NodeRunner";
import { PostTable } from "@/components/PostTable";
import { StrategyDrawer } from "@/components/StrategyDrawer";
import { MOCK_POSTS } from "@/lib/data";
import type { Post } from "@/lib/data";

const Index = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [showData, setShowData] = useState(true);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  const handleStartAgent = (_url: string) => {
    setIsRunning(true);
    setShowData(false);
  };

  const handleAgentComplete = useCallback(() => {
    setIsRunning(false);
    setShowData(true);
  }, []);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AstraSidebar />

      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Top bar */}
        <header className="px-6 py-4 border-b border-border">
          <div className="max-w-5xl">
            <CommandBar onStartAgent={handleStartAgent} isRunning={isRunning} />
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="max-w-5xl space-y-4">
            <NodeRunner isRunning={isRunning} onComplete={handleAgentComplete} />

            {showData && (
              <>
                <div className="flex items-baseline justify-between">
                  <h1 className="text-sm font-medium text-foreground">Post Analysis</h1>
                  <span className="text-[10px] font-mono-data text-muted-foreground">
                    Updated {new Date().toLocaleTimeString()}
                  </span>
                </div>
                <PostTable posts={MOCK_POSTS} onSelectPost={setSelectedPost} />
              </>
            )}

            {!showData && !isRunning && (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm font-mono-data">
                Paste a profile URL above to begin.
              </div>
            )}
          </div>
        </div>
      </main>

      <StrategyDrawer post={selectedPost} onClose={() => setSelectedPost(null)} />
    </div>
  );
};

export default Index;
