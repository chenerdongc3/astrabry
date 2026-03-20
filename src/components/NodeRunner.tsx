import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2 } from "lucide-react";
import { AGENT_STEPS } from "@/lib/data";
import { useLang } from "@/lib/i18n";

interface NodeRunnerProps {
  isRunning: boolean;
  onComplete: () => void;
}

const STEP_KEYS = ["scraper", "parser", "analyzer", "strategist"] as const;

export function NodeRunner({ isRunning, onComplete }: NodeRunnerProps) {
  const [currentStep, setCurrentStep] = useState(-1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const { t } = useLang();

  useEffect(() => {
    if (!isRunning) {
      setCurrentStep(-1);
      setCompletedSteps([]);
      return;
    }

    let stepIndex = 0;
    setCurrentStep(0);

    const runStep = () => {
      if (stepIndex >= AGENT_STEPS.length) {
        onComplete();
        return;
      }

      setTimeout(() => {
        setCompletedSteps((prev) => [...prev, stepIndex]);
        stepIndex++;
        setCurrentStep(stepIndex);
        runStep();
      }, AGENT_STEPS[stepIndex].duration);
    };

    runStep();
  }, [isRunning, onComplete]);

  if (!isRunning && completedSteps.length === 0) return null;

  return (
    <AnimatePresence>
      {isRunning && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="surface-card rounded-xl overflow-hidden border-primary/20"
        >
          <div className="px-4 py-3 border-b border-border/70 bg-gradient-to-r from-primary/10 to-transparent flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs font-mono-data text-muted-foreground">
              {t.agentLog}
            </span>
          </div>
          <div className="p-4 space-y-0">
            {AGENT_STEPS.map((step, i) => {
              const isComplete = completedSteps.includes(i);
              const isCurrent = currentStep === i;

              return (
                <motion.div
                  key={step.node}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className="flex items-start gap-3 relative"
                >
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isComplete
                          ? "bg-success/20"
                          : isCurrent
                          ? "bg-primary/20"
                          : "bg-muted"
                      }`}
                    >
                      {isComplete ? (
                        <CheckCircle2 className="h-3 w-3 text-success" />
                      ) : isCurrent ? (
                        <Loader2 className="h-3 w-3 text-primary animate-spin" />
                      ) : (
                        <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                      )}
                    </div>
                    {i < AGENT_STEPS.length - 1 && (
                      <div
                        className={`w-0.5 h-6 ${
                          isComplete ? "bg-success/40" : "bg-border"
                        }`}
                      />
                    )}
                  </div>
                  <div className="pb-6">
                    <span className="text-xs font-mono-data font-medium text-foreground">
                      [{step.node}]
                    </span>
                    <span className="text-xs font-mono-data text-muted-foreground ml-2">
                      {t[STEP_KEYS[i]]}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
