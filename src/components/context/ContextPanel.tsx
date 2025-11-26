import { useState, useEffect, useCallback } from 'react';
import { useChatContext } from '@/contexts/ChatContext';
import { Loader2, RefreshCw, Shield, Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ProtectedCanon {
  formattedContent: string;
  tokenEstimate: number;
  lessonCount: number;
  ruleCount: number;
}

interface MemoryDaemonStatus {
  daemonRunning: boolean;
  cacheSize: number;
  totalMemories: number;
  error?: string;
}

export const ContextPanel = () => {
  const { selectedWorkspaceId, selectedSessionId } = useChatContext();
  const [isLoading, setIsLoading] = useState(false);
  const [canon, setCanon] = useState<ProtectedCanon | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<MemoryDaemonStatus | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    canon: false,
    budget: true,
    daemon: true,
  });
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const loadContextData = useCallback(async () => {
    if (!selectedWorkspaceId || !window.electron) return;

    setIsLoading(true);
    try {
      // Load protected canon
      if (window.electron.contextGetProtectedCanon) {
        const canonResult = await window.electron.contextGetProtectedCanon(selectedWorkspaceId);
        if (canonResult.success && canonResult.canon) {
          setCanon(canonResult.canon);
        }
      }

      // Load daemon status
      if (window.electron.memoryDaemonStatus) {
        const status = await window.electron.memoryDaemonStatus();
        setDaemonStatus(status);
      }

      setLastRefresh(new Date());
    } catch (error) {
      console.error('[ContextPanel] Error loading context data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedWorkspaceId]);

  // Load data when workspace changes
  useEffect(() => {
    if (selectedWorkspaceId) {
      loadContextData();
    }
  }, [selectedWorkspaceId, loadContextData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(loadContextData, 30000);
    return () => clearInterval(interval);
  }, [loadContextData]);

  if (!selectedWorkspaceId) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        <p className="text-xs font-mono">Select a workspace to view context</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold font-mono text-xs uppercase tracking-wide">Context Status</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={loadContextData}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </Button>
      </div>

      {lastRefresh && (
        <p className="text-[10px] text-muted-foreground">
          Last updated: {lastRefresh.toLocaleTimeString()}
        </p>
      )}

      {/* Memory Daemon Status */}
      <div className="border border-border rounded-md overflow-hidden">
        <button
          onClick={() => toggleSection('daemon')}
          className="w-full flex items-center gap-2 p-2 bg-muted/50 hover:bg-muted/70 transition-colors"
        >
          {expandedSections.daemon ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <Brain className="h-3 w-3 text-purple-500" />
          <span className="text-xs font-mono font-medium">Memory Daemon</span>
          <span
            className={cn(
              'ml-auto text-[10px] px-1.5 py-0.5 rounded',
              daemonStatus?.daemonRunning
                ? 'bg-green-500/20 text-green-500'
                : 'bg-red-500/20 text-red-500'
            )}
          >
            {daemonStatus?.daemonRunning ? 'Running' : 'Stopped'}
          </span>
        </button>

        {expandedSections.daemon && (
          <div className="p-2 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cache size:</span>
              <span className="font-mono">{daemonStatus?.cacheSize ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total memories:</span>
              <span className="font-mono">{daemonStatus?.totalMemories ?? '-'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Protected Canon */}
      <div className="border border-border rounded-md overflow-hidden">
        <button
          onClick={() => toggleSection('canon')}
          className="w-full flex items-center gap-2 p-2 bg-muted/50 hover:bg-muted/70 transition-colors"
        >
          {expandedSections.canon ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <Shield className="h-3 w-3 text-amber-500" />
          <span className="text-xs font-mono font-medium">Protected Canon</span>
          {canon && (
            <span className="ml-auto text-[10px] text-muted-foreground font-mono">
              {canon.lessonCount}L / {canon.ruleCount}R
            </span>
          )}
        </button>

        {expandedSections.canon && (
          <div className="p-2 space-y-2">
            {canon ? (
              <>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Lessons:</span>
                  <span className="font-mono">{canon.lessonCount}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Rules:</span>
                  <span className="font-mono">{canon.ruleCount}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Est. tokens:</span>
                  <span className="font-mono">{canon.tokenEstimate}</span>
                </div>

                {canon.formattedContent && (
                  <div className="pt-2 border-t border-border">
                    <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
                      {canon.formattedContent}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground">No protected canon loaded</p>
            )}
          </div>
        )}
      </div>

      {/* Session Info */}
      {selectedSessionId && (
        <div className="p-2 bg-muted/30 rounded-md space-y-1 text-[10px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Session:</span>
            <span className="font-mono">{selectedSessionId.slice(0, 8)}...</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Workspace:</span>
            <span className="font-mono">{selectedWorkspaceId.slice(0, 8)}...</span>
          </div>
        </div>
      )}
    </div>
  );
};
