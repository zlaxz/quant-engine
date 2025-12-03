/**
 * CIOInsightPanel - Unified view into CIO's internal workings
 * Shows tool calls, memory recalls, streaming progress, and context usage
 */

import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToolCallTreeLive, type LiveToolCall } from './ToolCallTreeLive';
import { MemoryRecallPanel, type RecalledMemory } from './MemoryRecallPanel';
import { StreamingProgressBar } from './StreamingProgressBar';
import { ContextWindowIndicator } from './ContextWindowIndicator';
import { cn } from '@/lib/utils';

interface CIOInsightPanelProps {
  className?: string;
}

export function CIOInsightPanel({ className }: CIOInsightPanelProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingActive, setThinkingActive] = useState(false);
  const [tokensReceived, setTokensReceived] = useState(0);
  const [toolCalls, setToolCalls] = useState<LiveToolCall[]>([]);
  const [memories, setMemories] = useState<RecalledMemory[]>([]);
  const [searchQuery, setSearchQuery] = useState<string | undefined>();
  const [searchTimeMs, setSearchTimeMs] = useState<number | undefined>();
  const [contextUsage, setContextUsage] = useState({
    systemPrompt: 8000,
    conversationHistory: 0,
    memoryContext: 0,
    currentMessage: 0,
  });

  // Subscribe to IPC events
  useEffect(() => {
    if (!window.electron) return;

    const cleanups: Array<() => void> = [];

    // LLM streaming events
    const unsubStream = window.electron.onLLMStream?.((data) => {
      if (data.type === 'thinking') {
        setIsStreaming(true);
        setThinkingActive(true);
        setTokensReceived(prev => prev + (data.content?.length || 0) / 4);
      } else if (data.type === 'chunk') {
        setIsStreaming(true);
        setThinkingActive(false);
        setTokensReceived(prev => prev + (data.content?.length || 0) / 4);
      } else if (data.type === 'done' || data.type === 'cancelled') {
        setTimeout(() => {
          setIsStreaming(false);
          setThinkingActive(false);
          setTokensReceived(0);
        }, 500);
      }
    });
    if (unsubStream) cleanups.push(unsubStream);

    // Tool execution events (using existing onToolExecutionEvent)
    const unsubToolExec = window.electron.onToolExecutionEvent?.((event) => {
      const status = event.type === 'tool-complete' ? 'success' 
        : event.type === 'tool-error' ? 'error' 
        : 'running';
      
      const call: LiveToolCall = {
        id: `${event.tool}-${event.timestamp}`,
        tool: event.tool,
        args: event.args || {},
        status,
        timestamp: event.timestamp,
        duration: event.duration,
        error: event.error,
      };

      setToolCalls(prev => {
        // Find by tool name and timestamp proximity (within 100ms)
        const existing = prev.findIndex(t => 
          t.tool === call.tool && 
          Math.abs(t.timestamp - call.timestamp) < 100
        );
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = { ...updated[existing], ...call };
          return updated;
        }
        return [...prev, call].slice(-20); // Keep last 20
      });
    });
    if (unsubToolExec) cleanups.push(unsubToolExec);

    // Tool progress events (for thinking/tools-starting states)
    const unsubToolProgress = window.electron.onToolProgress?.((data) => {
      if (data.type === 'tools-starting' && data.tool) {
        const call: LiveToolCall = {
          id: `${data.tool}-${data.timestamp}`,
          tool: data.tool,
          args: data.args || {},
          status: 'pending',
          timestamp: data.timestamp,
        };
        setToolCalls(prev => [...prev, call].slice(-20));
      }
    });
    if (unsubToolProgress) cleanups.push(unsubToolProgress);

    return () => {
      cleanups.forEach(fn => fn());
    };
  }, []);

  // Expose method to update memories from ChatArea
  useEffect(() => {
    // @ts-expect-error - Expose for ChatArea to call
    window.__updateCIOInsightMemories = (
      recallResult: { memories: unknown[]; query: string; searchTimeMs: number }
    ) => {
      setSearchQuery(recallResult.query);
      setSearchTimeMs(recallResult.searchTimeMs);
      
      interface MemoryInput {
        id: string;
        content: string;
        summary?: string;
        category?: string;
        importance?: number;
        relevanceScore?: number;
        tags?: string[];
        createdAt?: string;
      }
      
      setMemories((recallResult.memories as MemoryInput[]).map((m) => ({
        id: m.id,
        content: m.content,
        summary: m.summary,
        category: m.category,
        importance: m.importance,
        tags: m.tags,
        recallScore: m.relevanceScore,
        createdAt: m.createdAt,
      })));

      // Update context usage estimate
      const memoryTokens = (recallResult.memories as MemoryInput[]).reduce(
        (sum, m) => sum + (m.content?.length || 0) / 4, 
        0
      );
      setContextUsage(prev => ({ ...prev, memoryContext: Math.round(memoryTokens) }));
    };

    // @ts-expect-error - Expose for ChatArea to call
    window.__updateCIOInsightContext = (usage: {
      systemPrompt: number;
      conversationHistory: number;
      memoryContext: number;
      currentMessage: number;
    }) => {
      setContextUsage(usage);
    };

    return () => {
      // @ts-expect-error - Cleanup
      delete window.__updateCIOInsightMemories;
      // @ts-expect-error - Cleanup
      delete window.__updateCIOInsightContext;
    };
  }, []);

  // Clear tool calls periodically when not streaming
  useEffect(() => {
    if (!isStreaming && toolCalls.length > 0) {
      const timer = setTimeout(() => {
        // Only clear completed calls after 30s of inactivity
        setToolCalls(prev => prev.filter(t => t.status === 'running'));
      }, 30000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isStreaming, toolCalls.length]);

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-3 space-y-4">
        {/* Streaming Progress - shows when active */}
        <StreamingProgressBar
          isStreaming={isStreaming}
          tokensReceived={tokensReceived}
          thinkingActive={thinkingActive}
        />

        {/* Context Window Indicator */}
        <ContextWindowIndicator usage={contextUsage} />

        {/* Tool Call Tree */}
        <ToolCallTreeLive calls={toolCalls} className="min-h-[200px]" />

        {/* Memory Recall Panel */}
        <MemoryRecallPanel 
          memories={memories}
          searchQuery={searchQuery}
          searchTimeMs={searchTimeMs}
          className="min-h-[200px]"
        />
      </div>
    </ScrollArea>
  );
}
