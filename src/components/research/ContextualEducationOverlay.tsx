import { AlertTriangle, TrendingDown, Calendar, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface PersonalPattern {
  id: string;
  patternType: string;
  title: string;
  description: string;
  occurrences: number;
  lastOccurrence: string;
  failures: Array<{
    date: string;
    runId: string;
    strategyName: string;
    degradation: number;
    details: string;
  }>;
  recommendation: string;
  severity: "low" | "medium" | "high";
}

interface ContextualEducationOverlayProps {
  pattern: PersonalPattern;
  currentContext: string;
  onDismiss: () => void;
  onViewHistory: () => void;
}

export function ContextualEducationOverlay({
  pattern,
  currentContext,
  onDismiss,
  onViewHistory,
}: ContextualEducationOverlayProps) {
  const severityColors = {
    low: "bg-yellow-500/10 border-yellow-500/50 text-yellow-600",
    medium: "bg-orange-500/10 border-orange-500/50 text-orange-600",
    high: "bg-red-500/10 border-red-500/50 text-red-600",
  };

  return (
    <Card
      className={`border-2 ${severityColors[pattern.severity]} p-6 shadow-lg animate-in slide-in-from-top duration-300`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h3 className="font-bold text-lg">⚠️ YOUR PATTERN TO BREAK</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {currentContext}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="font-mono">
              {pattern.patternType}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Occurred {pattern.occurrences} times in your last{" "}
              {pattern.occurrences + 2} backtests
            </span>
          </div>
          <p className="text-base font-medium">{pattern.title}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {pattern.description}
          </p>
        </div>

        <div className="bg-background/50 rounded-lg p-4 border">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold">IMPACT HISTORY</span>
          </div>
          <div className="space-y-2">
            {pattern.failures.slice(0, 3).map((failure) => (
              <div
                key={failure.runId}
                className="flex items-start justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {new Date(failure.date).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-mono text-destructive font-semibold">
                    {failure.degradation > 0 ? "-" : ""}
                    {Math.abs(failure.degradation)}%
                  </span>
                  <span className="text-muted-foreground ml-2">
                    degradation
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
          <p className="text-sm font-semibold mb-2">
            💡 This is YOUR pattern. Break it this time.
          </p>
          <p className="text-sm text-foreground/90">{pattern.recommendation}</p>
        </div>

        <div className="flex gap-2 mt-4">
          <Button
            onClick={onViewHistory}
            variant="outline"
            size="sm"
            className="flex-1"
          >
            View Full History
          </Button>
          <Button onClick={onDismiss} size="sm" className="flex-1">
            I'll Watch For This
          </Button>
        </div>
      </div>
    </Card>
  );
}
