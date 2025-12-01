import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Send, Loader2, Command, Slash, Code } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useChatContext } from '@/contexts/ChatContext';
import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { cn } from '@/lib/utils';
import { executeCommand, parseCommand, getCommandSuggestions, commands, setWriteConfirmationCallback } from '@/lib/slashCommands';
import { useWriteConfirmation } from '@/hooks/useWriteConfirmation';
import { useMemoryReinforcement } from '@/hooks/useMemoryReinforcement';
import { chatPrimary } from '@/lib/electronClient';
import { buildChiefQuantPrompt } from '@/prompts/chiefQuantPrompt';
import { detectIntent, type DetectedIntent } from '@/lib/intentDetector';
import { ActiveExperimentBar } from './ActiveExperimentBar';
import { getSuggestions, type AppState } from '@/lib/contextualSuggestions';
import { CommandSuggestions } from './CommandSuggestions';
import { RunResultCard } from './RunResultCard';
import { MessageCard } from './MessageCard';
import { isBacktestResult } from '@/types/chat';
import { SwarmStatusBar } from '@/components/swarm';
import { getJobProgress, type SwarmProgress } from '@/lib/swarmClient';
import {
  parseDisplayDirectives,
  stripDisplayDirectives,
  extractStage,
  extractVisualizations,
  extractProgress,
  extractFocus,
  shouldHide,
  parseArtifactDirective,
  extractTodoAdd,
  extractTodoComplete,
  extractTodoUpdate,
  // NEW: Data-driven directive parsers
  parseChartDirective,
  parseTableDirective,
  parseMetricsDirective,
  parseCodeDirective,
  parseUpdateChartDirective,
  parseUpdateTableDirective,
  parseNotificationDirective,
} from '@/lib/displayDirectiveParser';
import {
  AgentSpawnMonitor,
  ToolCallTree,
  ThinkingStream,
  ErrorCard,
  MemoryRecallToast,
  OperationProgress,
  OperationCard,
  ClaudeCodeErrorCard,
  ClaudeCodeProgressPanel,
  ClaudeCodeResultCard,
  DecisionCard,
  WorkingMemoryCheckpoint,
  EvidenceChain,
  parseEvidenceTrail,
  ContextualEducationOverlay,
  type AgentSpawn,
  type ToolCall,
  type ErrorDetails,
  type Memory,
  type OperationPhase,
  type OperationCardData,
  type ClaudeCodeError,
  type ClaudeCodeProgressData,
  type DecisionReasoning,
  type WorkingMemoryState,
  type EvidenceNode,
  type PersonalPattern,
} from '@/components/research';
import { ClaudeCodeArtifact } from '@/types/api-contract';
import { ErrorBoundary } from '@/components/ErrorBoundary';

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
  model?: string; // Which model generated this: 'gemini' | 'claude' | 'deepseek'
}

const ChatAreaComponent = () => {
  const { selectedSessionId, selectedWorkspaceId, activeExperiment, setActiveExperiment } = useChatContext();
  const displayContext = useResearchDisplay();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [_isFetchingMessages, setIsFetchingMessages] = useState(false);
  const [commandSuggestions, setCommandSuggestions] = useState<string[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [intentSuggestion, setIntentSuggestion] = useState<DetectedIntent | null>(null);
  const [appState, setAppState] = useState<AppState>({});
  const [showContextualSuggestions, setShowContextualSuggestions] = useState(true);
  const [toolProgress, setToolProgress] = useState<Array<{
    type: string;
    tool?: string;
    args?: Record<string, any>;
    success?: boolean;
    preview?: string;
    iteration?: number;
    count?: number;
    message?: string;
    timestamp: number;
  }>>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [_isStreaming, setIsStreaming] = useState(false);
  const [activeSwarmJob, setActiveSwarmJob] = useState<{
    jobId: string;
    objective: string;
    progress: SwarmProgress;
  } | null>(null);
  // PERF: Cache memory context for session - don't re-fetch every message
  const [cachedMemoryContext, setCachedMemoryContext] = useState<string | null>(null);
  
  // New visual enhancement states
  const [activeAgents, setActiveAgents] = useState<AgentSpawn[]>([]);
  const [toolCallTree, setToolCallTree] = useState<ToolCall[]>([]);
  const [operationCards, setOperationCards] = useState<OperationCardData[]>([]);
  const [decisionCard, setDecisionCard] = useState<DecisionReasoning | null>(null);
  const [errorCard, setErrorCard] = useState<ClaudeCodeError | null>(null);
  const [progressPanel, setProgressPanel] = useState<ClaudeCodeProgressData | null>(null);
  const [checkpoint, setCheckpoint] = useState<WorkingMemoryState | null>(null);
  const [evidenceChain, setEvidenceChain] = useState<EvidenceNode[]>([]);
  const [claudeCodeArtifact, setClaudeCodeArtifact] = useState<ClaudeCodeArtifact | null>(null);
  const [personalPattern, setPersonalPattern] = useState<PersonalPattern | null>(null);
  const [thinkingContent, setThinkingContent] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [currentError, setCurrentError] = useState<ErrorDetails | null>(null);
  const [memoryRecalls, setMemoryRecalls] = useState<Memory[]>([]);
  const [operationPhases, setOperationPhases] = useState<OperationPhase[]>([]);
  const [operationStartTime, setOperationStartTime] = useState<number>(Date.now());
  
  
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check Python server health on mount
  useEffect(() => {
    const checkPythonServer = async () => {
      if (!window.electron?.checkQuantEngineHealth) return;

      try {
        const health = await window.electron.checkQuantEngineHealth();
        if (!health.available) {
          toast({
            title: 'Python Server Not Running',
            description: 'Start the Python server with: python python/server.py',
            variant: 'destructive',
            duration: 10000,
          });
        }
      } catch (error) {
        console.warn('[ChatArea] Could not check Python server health:', error);
      }
    };

    checkPythonServer();
  }, [toast]);

  // Function to save messages with retry logic
  const saveMessagesToDb = async (messages: any[]): Promise<boolean> => {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const { error } = await supabase.from('messages').insert(messages);
      if (!error) {
        return true;
      }

      lastError = error;
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 3s
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }

    console.error('Failed to save messages after retries:', lastError);
    toast({
      title: 'Save Failed',
      description: 'Messages may not persist. Check your connection.',
      variant: 'destructive',
    });
    return false;
  };
  
  // Write confirmation hook
  const { showConfirmation, ConfirmationDialog } = useWriteConfirmation();

  // Memory reinforcement hook - monitors for stale critical memories
  useMemoryReinforcement();

  // Set global confirmation callback for slash commands
  useEffect(() => {
    setWriteConfirmationCallback(showConfirmation);
    return () => setWriteConfirmationCallback(undefined);
  }, [showConfirmation]);

  // Define loadMessages BEFORE the useEffect that depends on it (prevents TDZ error)
  const loadMessages = useCallback(async () => {
    if (!selectedSessionId) return;

    try {
      setIsFetchingMessages(true);
      const { data, error } = await supabase
        .from('messages')
        .select('id, role, content, created_at, model, provider')
        .eq('session_id', selectedSessionId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);

      // Count backtest commands in message history to initialize runCount
      if (data && selectedWorkspaceId) {
        const backtestCount = data.filter(
          (msg) => msg.role === 'system' && msg.content.includes('Command: /backtest')
        ).length;

        setAppState(prev => ({ ...prev, runCount: backtestCount }));
      }
    } catch (error: any) {
      console.error('Error loading messages:', error);
      toast({
        title: 'Error',
        description: 'Failed to load messages',
        variant: 'destructive',
      });
    } finally {
      setIsFetchingMessages(false);
    }
  }, [selectedSessionId, selectedWorkspaceId, toast]);

  // Subscribe to IPC events for tool progress and streaming (Electron only)
  // LOVABLE FIX 2024-11-25: Guard against undefined window.electron
  useEffect(() => {
    // Skip if not running in Electron (required for Lovable/browser mode)
    if (!window.electron?.onToolProgress || !window.electron?.onLLMStream) {
      console.log('[ChatArea] Skipping IPC subscriptions - not in Electron');
      return;
    }

    let currentCleanupTimer: NodeJS.Timeout | null = null;

    // Subscribe to tool progress
    const unsubscribeTool = window.electron.onToolProgress((data) => {
      setToolProgress(prev => [...prev, data]);
    });

    // Subscribe to LLM streaming
    const unsubscribeStream = window.electron.onLLMStream((data) => {
      if (data.type === 'chunk' && data.content) {
        setStreamingContent(prev => prev + data.content);
        setIsStreaming(true);
      } else if (data.type === 'done') {
        setIsStreaming(false);
        // Clear streaming content after it's shown in final message
        if (currentCleanupTimer) clearTimeout(currentCleanupTimer);
        currentCleanupTimer = setTimeout(() => setStreamingContent(''), 100);
      } else if (data.type === 'error') {
        setIsStreaming(false);
        console.error('[ChatArea] Stream error:', data);
      } else if (data.type === 'thinking') {
        setThinkingContent(data.content || 'Thinking...');
      } else if (data.type === 'cancelled') {
        // Request was cancelled by user
        setIsStreaming(false);
        setIsLoading(false);
      }
    });

    return () => {
      if (currentCleanupTimer) clearTimeout(currentCleanupTimer);
      unsubscribeTool();
      unsubscribeStream();
    };
  }, []);

  // Listen for Claude Code directive emissions (real-time UI control)
  useEffect(() => {
    if (!window.electron?.onClaudeCodeDirectives) return;

    const unsubDirectives = window.electron.onClaudeCodeDirectives((event) => {
      console.log('[ChatArea] Claude Code emitted directives:', event.directives);

      // Process old-style directives (backwards compat)
      event.directives.forEach((directive: any) => {
        try {
          if (directive.type === 'stage') {
            displayContext.updateStage(directive.value);
          } else if (directive.type === 'display') {
            displayContext.showVisualization(directive.value, directive.params);
          } else if (directive.type === 'progress') {
            const percent = parseInt(directive.value);
            displayContext.updateProgress(percent, directive.params?.message);
          } else if (directive.type === 'focus') {
            displayContext.setFocus(directive.value);
          } else if (directive.type === 'hide') {
            displayContext.hideAllVisualizations();
          } else if (directive.type === 'todo_add') {
            displayContext.addTask(directive.params?.description || '', directive.value as any);
          } else if (directive.type === 'todo_complete') {
            displayContext.completeTask(directive.value);
          } else if (directive.type === 'todo_update') {
            displayContext.updateTask(directive.value, directive.params?.description || '');
          }
        } catch (error) {
          console.error('[ChatArea] Failed to process Claude Code directive:', directive.type, error);
          toast({
            title: 'Directive Error',
            description: `Failed to process ${directive.type} directive`,
            variant: 'destructive',
            duration: 3000
          });
        }
      });

      // Also parse new data-driven directives from the raw text
      // (Claude Code outputs text with directives, need to parse again)
      const fullOutput = event.rawOutput || '';

      const chartDir = parseChartDirective(fullOutput);
      if (chartDir) {
        try {
          console.log('[ChatArea] Claude Code chart directive:', chartDir);
          displayContext.showChart(chartDir);
        } catch (error) {
          console.error('[ChatArea] Failed to show chart:', error);
          toast({
            title: 'Chart Error',
            description: 'Failed to display chart directive',
            variant: 'destructive',
            duration: 3000
          });
        }
      }

      const tableDir = parseTableDirective(fullOutput);
      if (tableDir) {
        try {
          console.log('[ChatArea] Claude Code table directive:', tableDir);
          displayContext.showTable(tableDir);
        } catch (error) {
          console.error('[ChatArea] Failed to show table:', error);
          toast({
            title: 'Table Error',
            description: 'Failed to display table directive',
            variant: 'destructive',
            duration: 3000
          });
        }
      }

      const metricsDir = parseMetricsDirective(fullOutput);
      if (metricsDir) {
        try {
          console.log('[ChatArea] Claude Code metrics directive:', metricsDir);
          displayContext.showMetrics(metricsDir);
        } catch (error) {
          console.error('[ChatArea] Failed to show metrics:', error);
          toast({
            title: 'Metrics Error',
            description: 'Failed to display metrics directive',
            variant: 'destructive',
            duration: 3000
          });
        }
      }

      const codeDir = parseCodeDirective(fullOutput);
      if (codeDir) {
        try {
          console.log('[ChatArea] Claude Code code directive:', codeDir);
          displayContext.showCode(codeDir);
        } catch (error) {
          console.error('[ChatArea] Failed to show code:', error);
          toast({
            title: 'Code Error',
            description: 'Failed to display code directive',
            variant: 'destructive',
            duration: 3000
          });
        }
      }

      const updateChartDir = parseUpdateChartDirective(fullOutput);
      if (updateChartDir) {
        try {
          console.log('[ChatArea] Claude Code update chart directive:', updateChartDir);
          displayContext.updateChart(updateChartDir.id, updateChartDir);
        } catch (error) {
          console.error('[ChatArea] Failed to update chart:', error);
          toast({
            title: 'Chart Update Error',
            description: 'Failed to update chart',
            variant: 'destructive',
            duration: 3000
          });
        }
      }

      const updateTableDir = parseUpdateTableDirective(fullOutput);
      if (updateTableDir) {
        try {
          console.log('[ChatArea] Claude Code update table directive:', updateTableDir);
          displayContext.updateTable(updateTableDir.id, updateTableDir);
        } catch (error) {
          console.error('[ChatArea] Failed to update table:', error);
          toast({
            title: 'Table Update Error',
            description: 'Failed to update table',
            variant: 'destructive',
            duration: 3000
          });
        }
      }

      const notificationDir = parseNotificationDirective(fullOutput);
      if (notificationDir) {
        console.log('[ChatArea] Claude Code notification directive:', notificationDir);
        toast({
          title: notificationDir.title || 'Notification',
          description: notificationDir.message,
          variant: notificationDir.type === 'error' ? 'destructive' : 'default',
          duration: notificationDir.duration || 5000,
        });
      }
    });

    return () => {
      unsubDirectives();
    };
  }, [toast]); // Removed displayContext - methods are stable via useCallback

  // Listen for detailed tool execution events for ToolCallTree and OperationCards
  useEffect(() => {
    if (!window.electron?.onToolExecutionEvent || !window.electron?.onClaudeCodeEvent) return;

    const unsubToolEvents = window.electron.onToolExecutionEvent((event: {
      type: 'tool-start' | 'tool-complete' | 'tool-error';
      tool: string;
      args: Record<string, any>;
      result?: any;
      error?: string;
      timestamp: number;
      duration?: number;
      whyThis?: string;
      whatFound?: string;
    }) => {
      if (event.type === 'tool-start') {
        // Add new tool call to tree
        const newCall: ToolCall = {
          id: `${event.tool}-${event.timestamp}`,
          tool: event.tool,
          args: event.args,
          timestamp: event.timestamp,
        };
        setToolCallTree(prev => [...prev, newCall]);

        // Add placeholder operation card with whyThis marker
        const newCard: OperationCardData = {
          id: `${event.tool}-${event.timestamp}`,
          tool: event.tool,
          args: event.args,
          timestamp: event.timestamp,
          success: false, // Pending
          whyThis: event.whyThis
        };
        setOperationCards(prev => [...prev, newCard]);
      } else if (event.type === 'tool-complete' || event.type === 'tool-error') {
        // Update existing tool call with result
        setToolCallTree(prev => prev.map(call => {
          // Match by tool name AND timestamp to ensure we update the right call
          if (call.tool === event.tool && Math.abs(call.timestamp - event.timestamp) < 100) {
            return {
              ...call,
              result: event.result || event.error,
              duration: event.duration,
              success: event.type === 'tool-complete'
            };
          }
          return call;
        }));

        // Update operation card with result + whatFound marker
        setOperationCards(prev => prev.map(card => {
          if (card.tool === event.tool && Math.abs(card.timestamp - event.timestamp) < 100) {
            return {
              ...card,
              result: event.result,
              error: event.error,
              duration: event.duration,
              success: event.type === 'tool-complete',
              whatFound: event.whatFound
            };
          }
          return card;
        }));
      }
    });

    const unsubClaudeEvents = window.electron.onClaudeCodeEvent((event: {
      type: 'decision' | 'progress' | 'error' | 'checkpoint' | 'complete' | 'cancelled';
      data: unknown;
    }) => {
      if (event.type === 'decision') {
        setDecisionCard(event.data as DecisionReasoning);
      } else if (event.type === 'progress') {
        setProgressPanel(event.data as ClaudeCodeProgressData);
      } else if (event.type === 'complete') {
        // Clear progress panel on completion
        setProgressPanel(null);
        toast({
          title: 'Claude Code Execution Complete',
          description: 'Task completed successfully',
        });
      } else if (event.type === 'cancelled') {
        setProgressPanel(null);
        toast({
          title: 'Execution Cancelled',
          description: (event.data as any).message || 'Claude Code execution was cancelled',
          variant: 'destructive',
        });
      } else if (event.type === 'error') {
        setProgressPanel(null);
        setErrorCard(event.data as ClaudeCodeError);
      } else if (event.type === 'checkpoint') {
        setCheckpoint(event.data as WorkingMemoryState);
      }
    });

    return () => {
      unsubToolEvents();
      unsubClaudeEvents();
    };
  }, []);

  // Clear all transient UI when starting a NEW user message
  useEffect(() => {
    if (isLoading && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === 'user') {
        setToolCallTree([]);
        setOperationCards([]);
        setDecisionCard(null);
        setErrorCard(null);
        setProgressPanel(null);
        setEvidenceChain([]);
        setClaudeCodeArtifact(null);
        setMemoryRecalls([]);
        setActiveAgents([]);
        setThinkingContent('');
        setCheckpoint(null);
        setCurrentError(null);
        setOperationPhases([]);
      }
    }
  }, [isLoading, messages]);

  // ESC key handler for cancelling requests
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isLoading) {
        e.preventDefault();
        console.log('[ChatArea] ESC pressed - cancelling request');

        // Call cancel request if in Electron
        if (window.electron?.cancelRequest) {
          window.electron.cancelRequest().then(() => {
            toast({
              title: 'Request Cancelled',
              description: 'The agent was stopped by ESC key',
            });
            setIsLoading(false);
            setStreamingContent('');
            setToolProgress([]);
          }).catch((err: Error) => {
            console.error('[ChatArea] Cancel request failed:', err);
          });
        } else {
          // Browser mode - just reset loading state
          setIsLoading(false);
          setStreamingContent('');
          setToolProgress([]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, toast]);

  // Load messages when session changes - also clear memory cache
  useEffect(() => {
    if (selectedSessionId) {
      loadMessages();
      // Reset visualizations when switching sessions (cleanup)
      displayContext.resetState();
      setCachedMemoryContext(null); // Clear memory cache for new session
    } else {
      setMessages([]);
      setCachedMemoryContext(null);
    }
  }, [selectedSessionId, loadMessages, displayContext]);

  // Auto-scroll to bottom when messages, tool progress, or streaming content change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolProgress, streamingContent]);

  // Update command suggestions and intent detection when input changes
  useEffect(() => {
    if (inputValue.startsWith('/')) {
      const suggestions = getCommandSuggestions(inputValue);
      setCommandSuggestions(suggestions);
      setIntentSuggestion(null); // Clear intent when typing slash command
    } else {
      setCommandSuggestions([]);
      // Detect intent for natural language input
      const intent = detectIntent(inputValue);
      if (intent && intent.confidence >= 0.7) {
        setIntentSuggestion(intent);
      } else {
        setIntentSuggestion(null);
      }
    }
  }, [inputValue]);

  const sendMessage = async () => {
    if (!inputValue.trim() || !selectedSessionId || !selectedWorkspaceId) return;

    const messageContent = inputValue.trim();
    setInputValue('');
    setCommandSuggestions([]);

    // Clear progress state for new message
    setToolProgress([]);
    setStreamingContent('');

    setIsLoading(true);

    try {
      // Check if this is a slash command
      const parsed = parseCommand(messageContent);
      
      if (parsed) {
        // Execute slash command
        const result = await executeCommand(messageContent, {
          sessionId: selectedSessionId,
          workspaceId: selectedWorkspaceId,
          setActiveExperiment,
        });

        // Add command and result as system messages
        const commandMessage: Message = {
          id: `cmd-${Date.now()}`,
          role: 'system',
          content: `Command: ${messageContent}`,
          created_at: new Date().toISOString(),
        };

        const resultMessage: Message = {
          id: `result-${Date.now()}`,
          role: 'system',
          content: result.message,
          created_at: new Date().toISOString(),
        };

        setMessages(prev => [...prev, commandMessage, resultMessage]);

        // Update app state based on command type for contextual suggestions
        if (result.success && parsed) {
          const commandName = parsed.command;

          if (commandName === 'backtest') {
            // Extract run ID from result if available
            const runIdMatch = result.data?.runId || result.message.match(/run ID: (\S+)/i)?.[1];
            setAppState(prev => ({
              ...prev,
              lastAction: 'backtest',
              lastRunId: runIdMatch,
              runCount: (prev.runCount || 0) + 1
            }));
            setShowContextualSuggestions(true);
          } else if (commandName === 'audit_run') {
            setAppState(prev => ({ ...prev, lastAction: 'audit' }));
            setShowContextualSuggestions(true);
          } else if (commandName === 'compare') {
            setAppState(prev => ({ ...prev, lastAction: 'compare' }));
            setShowContextualSuggestions(true);
          } else if (commandName === 'note') {
            setAppState(prev => ({ ...prev, lastAction: 'insight' }));
            setShowContextualSuggestions(true);
          }

          // Check if this is a swarm job result (e.g., /evolve_strategy)
          if (result.data?.jobId && result.data?.mode) {
            try {
              // Parse the swarm job details from the result message
              const swarmJobData = JSON.parse(result.message);
              if (swarmJobData.type === 'swarm_job') {
                // Fetch initial progress and activate swarm monitor
                const initialProgress = await getJobProgress(result.data.jobId);
                setActiveSwarmJob({
                  jobId: result.data.jobId,
                  objective: swarmJobData.objective || `Swarm: ${result.data.mode}`,
                  progress: initialProgress,
                });
              }
            } catch (parseError) {
              // Not a JSON swarm job message, that's fine
              console.log('[ChatArea] Not a swarm job result, continuing normally');
            }
          }
        }

        if (!result.success) {
          toast({
            title: 'Command Failed',
            description: result.message.split('\n')[0],
            variant: 'destructive',
          });
        }
      } else {
        // Regular chat message - build messages array and call LLM directly
        
        // Check for personal patterns before sending message (Phase 7)
        if (selectedWorkspaceId && window.electron?.patternDetect) {
          try {
            const result = await window.electron.patternDetect(
              selectedWorkspaceId,
              messageContent
            );
            if (result.pattern && result.confidence > 0.7) {
              setPersonalPattern(result.pattern);
              // Pattern shown but doesn't block message sending
            }
          } catch (error) {
            console.error('[Pattern Detection] Error:', error);
            // Continue even if pattern detection fails
          }
        }

        // Add user message optimistically to UI
        const userMessage: Message = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: messageContent,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, userMessage]);

        // ============ MEMORY CONTEXT (CACHED PER SESSION) ============
        // PERF: Only fetch memories ONCE per session, then reuse
        const basePrompt = buildChiefQuantPrompt();
        let memoryContext = cachedMemoryContext || '';

        // Only fetch memories if we don't have them cached
        if (!cachedMemoryContext && selectedWorkspaceId && window.electron?.memoryRecall) {
          try {
            const memoryQuery = messageContent.slice(0, 500);
            const recallResult = await window.electron.memoryRecall(memoryQuery, selectedWorkspaceId, {
              limit: 10,
              minImportance: 0.4,
              useCache: true,
              rerank: false, // Skip reranking for speed
            });

            if (recallResult?.memories && Array.isArray(recallResult.memories) && recallResult.memories.length > 0) {
              memoryContext = await window.electron.memoryFormatForPrompt(recallResult.memories);
              setCachedMemoryContext(memoryContext); // Cache for session

              toast({
                title: '🧠 Memory Loaded',
                description: `${recallResult.memories.length} memories cached for this session`,
              });
            }
          } catch (memoryError) {
            console.error('[ChatArea] Memory recall failed:', memoryError);
          }
        }

        // ============ BUILD LLM MESSAGES (FAST PATH) ============
        const enrichedSystemPrompt = memoryContext
          ? `${basePrompt}\n\n${memoryContext}`
          : basePrompt;

        // Simple truncation to prevent context overflow
        const MAX_HISTORY_CHARS = 400000;
        let historyMessages = messages.map(m => ({ role: m.role, content: m.content }));
        let totalChars = historyMessages.reduce((sum, m) => sum + m.content.length, 0);
        while (totalChars > MAX_HISTORY_CHARS && historyMessages.length > 0) {
          const removed = historyMessages.shift();
          if (removed) totalChars -= removed.content.length;
        }

        const llmMessages = [
          { role: 'system', content: enrichedSystemPrompt },
          ...historyMessages,
          { role: 'user', content: messageContent }
        ];

        // Call LLM via Electron IPC
        const response = await chatPrimary(llmMessages);

        // Parse display directives from response
        const directives = parseDisplayDirectives(response.content);
        if (directives.length > 0) {
          console.log('[ChatArea] Parsed display directives:', directives);
          // Update stage if present
          const stage = extractStage(directives);
          if (stage) {
            displayContext.updateStage(stage);
          }

          // Show visualizations if present
          const visualizations = extractVisualizations(directives);
          visualizations.forEach(viz => {
            displayContext.showVisualization(viz);
          });

          // Update progress if present
          const progress = extractProgress(directives);
          if (progress) {
            displayContext.updateProgress(progress.percent, progress.message);
          }

          // Update focus if present
          const focus = extractFocus(directives);
          if (focus) {
            displayContext.setFocus(focus);
          }

          // Hide visualizations if requested
          if (shouldHide(directives)) {
            displayContext.hideAllVisualizations();
          }

          // Process TODO directives
          const todoAdds = extractTodoAdd(directives);
          todoAdds.forEach(({ category, description }) => {
            displayContext.addTask(description, category as any);
          });

          const todoCompletes = extractTodoComplete(directives);
          todoCompletes.forEach(taskId => {
            displayContext.completeTask(taskId);
          });

          const todoUpdates = extractTodoUpdate(directives);
          todoUpdates.forEach(({ taskId, description }) => {
            displayContext.updateTask(taskId, description);
          });
        }

        // Parse artifact directive (if present)
        const artifact = parseArtifactDirective(response.content);
        if (artifact) {
          console.log('[ChatArea] Parsed artifact directive:', artifact);
          displayContext.showArtifact(artifact);
        }

        // Parse evidence trail from response
        const evidenceNodes = parseEvidenceTrail(response.content);
        if (evidenceNodes.length > 0) {
          console.log('[ChatArea] Parsed evidence trail:', evidenceNodes);
          setEvidenceChain(evidenceNodes);
        }

        // NEW: Parse data-driven directives
        const chartDirective = parseChartDirective(response.content);
        if (chartDirective) {
          try {
            console.log('[ChatArea] Parsed chart directive:', chartDirective);
            displayContext.showChart(chartDirective);
          } catch (error) {
            console.error('[ChatArea] Failed to show chart:', error);
          }
        }

        const tableDirective = parseTableDirective(response.content);
        if (tableDirective) {
          try {
            console.log('[ChatArea] Parsed table directive:', tableDirective);
            displayContext.showTable(tableDirective);
          } catch (error) {
            console.error('[ChatArea] Failed to show table:', error);
          }
        }

        const metricsDirective = parseMetricsDirective(response.content);
        if (metricsDirective) {
          try {
            console.log('[ChatArea] Parsed metrics directive:', metricsDirective);
            displayContext.showMetrics(metricsDirective);
          } catch (error) {
            console.error('[ChatArea] Failed to show metrics:', error);
          }
        }

        const codeDirective = parseCodeDirective(response.content);
        if (codeDirective) {
          try {
            console.log('[ChatArea] Parsed code directive:', codeDirective);
            displayContext.showCode(codeDirective);
          } catch (error) {
            console.error('[ChatArea] Failed to show code:', error);
          }
        }

        const updateChartDirective = parseUpdateChartDirective(response.content);
        if (updateChartDirective) {
          try {
            console.log('[ChatArea] Parsed update chart directive:', updateChartDirective);
            displayContext.updateChart(updateChartDirective.id, updateChartDirective);
          } catch (error) {
            console.error('[ChatArea] Failed to update chart:', error);
          }
        }

        const updateTableDirective = parseUpdateTableDirective(response.content);
        if (updateTableDirective) {
          try {
            console.log('[ChatArea] Parsed update table directive:', updateTableDirective);
            displayContext.updateTable(updateTableDirective.id, updateTableDirective);
          } catch (error) {
            console.error('[ChatArea] Failed to update table:', error);
          }
        }

        const notificationDirective = parseNotificationDirective(response.content);
        if (notificationDirective) {
          console.log('[ChatArea] Parsed notification directive:', notificationDirective);
          toast({
            title: notificationDirective.title || 'Notification',
            description: notificationDirective.message,
            variant: notificationDirective.type === 'error' ? 'destructive' : 'default',
            duration: notificationDirective.duration || 5000,
          });
        }

        // Strip directives from content for clean display
        const cleanContent = stripDisplayDirectives(response.content);

        // Add assistant response to UI (with clean content)
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: cleanContent,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMessage]);

        // Save both messages to database with retry logic (save original with directives)
        await saveMessagesToDb([
          { session_id: selectedSessionId, role: 'user', content: messageContent },
          { session_id: selectedSessionId, role: 'assistant', content: response.content, provider: response.provider, model: response.model }
        ]);
      }
    } catch (error: any) {
      console.error('Error sending message:', error);
      const fullError = error.message || 'Failed to send message';
      
      // Show full error in scrollable, copyable toast
      toast({
        title: 'Error',
        description: fullError,
        variant: 'destructive',
        duration: 15000,
        style: {
          maxHeight: '400px',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          userSelect: 'text',
          cursor: 'text',
        },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Demo mode simulation
  const runDemoConversation = async () => {
    setIsLoading(true);
    setToolProgress([]);
    setStreamingContent('');
    
    // Import demo data
    const { getDemoMemoryRecalls, getDemoAgents, getDemoToolCallTree, getDemoOperationPhases, getDemoThinkingText } = await import('@/lib/demoData');
    
    // Reset all visual states
    setActiveAgents([]);
    setToolCallTree([]);
    setThinkingContent('');
    setIsThinking(false);
    setCurrentError(null);
    setMemoryRecalls([]);
    setOperationPhases([]);
    setOperationStartTime(Date.now());

    // Add user message
    const userMsg: Message = {
      id: `demo-user-${Date.now()}`,
      role: 'user',
      content: 'Can you analyze the rotation-engine codebase and explain the convexity profiles?',
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    await new Promise(r => setTimeout(r, 300));
    
    // Add system message showing command execution
    const systemMsg: Message = {
      id: `demo-system-${Date.now()}`,
      role: 'system',
      content: 'Command: /search_code pattern:convexity path:rotation-engine',
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, systemMsg]);

    await new Promise(r => setTimeout(r, 300));

    // Show memory recall
    setMemoryRecalls(getDemoMemoryRecalls());

    await new Promise(r => setTimeout(r, 800));

    // Show operation phases
    setOperationPhases(getDemoOperationPhases());

    // Show agents and tool tree
    setActiveAgents(getDemoAgents());
    setToolCallTree(getDemoToolCallTree());

    await new Promise(r => setTimeout(r, 500));

    // Start thinking
    setIsThinking(true);
    const thinkingText = getDemoThinkingText();
    
    for (let i = 0; i < thinkingText.length; i += 20) {
      setThinkingContent(thinkingText.slice(0, i + 20));
      await new Promise(r => setTimeout(r, 50));
    }
    setThinkingContent(thinkingText);

    await new Promise(r => setTimeout(r, 800));
    
    // Stop thinking
    setIsThinking(false);

    // Simulate tool 1: list_directory
    setToolProgress([{
      type: 'executing',
      tool: 'list_directory',
      args: { path: 'src/profiles' },
      timestamp: Date.now()
    }]);

    await new Promise(r => setTimeout(r, 1200));

    setToolProgress(prev => [
      ...prev,
      {
        type: 'completed',
        tool: 'list_directory',
        success: true,
        preview: 'Found 5 files: __init__.py, detectors.py, features.py, profiles.py, visualizer.py',
        timestamp: Date.now()
      }
    ]);

    await new Promise(r => setTimeout(r, 400));

    // Simulate tool 2: read_file
    setToolProgress(prev => [
      ...prev,
      {
        type: 'executing',
        tool: 'read_file',
        args: { path: 'src/profiles/profiles.py' },
        timestamp: Date.now()
      }
    ]);

    await new Promise(r => setTimeout(r, 1500));

    setToolProgress(prev => [
      ...prev,
      {
        type: 'completed',
        tool: 'read_file',
        success: true,
        preview: 'ConvexityProfile class with 8 profile types: LONG_GAMMA, SHORT_GAMMA, LONG_VEGA...',
        timestamp: Date.now()
      }
    ]);

    await new Promise(r => setTimeout(r, 400));

    // Simulate tool 3: search_code
    setToolProgress(prev => [
      ...prev,
      {
        type: 'executing',
        tool: 'search_code',
        args: { pattern: 'convexity', path: 'src' },
        timestamp: Date.now()
      }
    ]);

    await new Promise(r => setTimeout(r, 1000));

    setToolProgress(prev => [
      ...prev,
      {
        type: 'completed',
        tool: 'search_code',
        success: true,
        preview: 'Found 23 matches across 7 files related to convexity calculations',
        timestamp: Date.now()
      }
    ]);

    await new Promise(r => setTimeout(r, 600));

    // Start streaming response
    const response = `Based on the codebase analysis, the rotation-engine uses 8 distinct convexity profiles:

**Core Profiles:**
1. **LONG_GAMMA** - Profits from realized volatility, loses from theta decay
2. **SHORT_GAMMA** - Collects theta, risks gap moves
3. **LONG_VEGA** - Profits from vol expansion, has positive convexity
4. **SHORT_VEGA** - Collects premium, negative convexity exposure

**Hybrid Profiles:**
5. **STRADDLE** - Pure volatility play, delta-neutral
6. **STRANGLE** - Wider breakevens, cheaper than straddles
7. **IRON_CONDOR** - Range-bound bet, defined risk
8. **BUTTERFLY** - Narrow profit zone, low cost

Each profile is regime-aware and adjusts parameters based on VIX levels and market conditions. The system pairs profiles with regimes for optimal P&L.`;

    for (let i = 0; i < response.length; i += 3) {
      setStreamingContent(response.slice(0, i + 3));
      await new Promise(r => setTimeout(r, 20));
    }

    setStreamingContent(response);
    await new Promise(r => setTimeout(r, 500));

    // Add final assistant message
    const assistantMsg: Message = {
      id: `demo-assistant-${Date.now()}`,
      role: 'assistant',
      content: response,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, assistantMsg]);

    // Add mock operation cards to show the kanban design
    const mockOperations: OperationCardData[] = [
      {
        id: 'demo-op-1',
        tool: 'read_file',
        args: {
          filePath: '/rotation-engine/strategies/short_gamma_scalper.py',
        },
        result: {
          content: 'Successfully read 342 lines of strategy code',
          lines: 342,
        },
        timestamp: Date.now() - 3000,
        duration: 45,
        success: true,
      },
      {
        id: 'demo-op-2',
        tool: 'list_dir',
        args: {
          path: '/rotation-engine/data/2024',
        },
        result: [
          { name: 'SPX_2024-01-15.csv', type: 'file' },
          { name: 'SPX_2024-02-15.csv', type: 'file' },
          { name: 'VIX_2024-01-15.csv', type: 'file' },
        ],
        timestamp: Date.now() - 2000,
        duration: 23,
        success: true,
      },
      {
        id: 'demo-op-3',
        tool: 'search_code',
        args: {
          pattern: 'convexity',
          path: '/rotation-engine/src',
        },
        result: {
          matches: 23,
          files: ['profile_manager.py', 'regime_detector.py', 'backtest_engine.py'],
        },
        timestamp: Date.now() - 1000,
        duration: 167,
        success: true,
      },
    ];
    setOperationCards(mockOperations);

    setIsLoading(false);
    setStreamingContent('');
    setToolProgress([]);

    toast({
      title: '✨ Demo Complete',
      description: 'Check out the new kanban-style card design!',
    });
  };

  // Active Experiment handlers
  const handleViewResults = () => {
    if (activeExperiment?.lastRunId) {
      // Scroll to or highlight results in the chat
      // For now, we'll just show a toast
      toast({
        title: 'View Results',
        description: `Viewing results for run #${activeExperiment.lastRunId.slice(-6)}`,
      });
    }
  };

  const handleIterate = () => {
    setInputValue('/iterate ');
  };

  const handleNewRun = () => {
    setInputValue('/backtest ');
  };

  if (!selectedSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/20">
        <div className="text-center space-y-2">
          <div className="text-4xl">💬</div>
          <p className="text-sm font-mono text-muted-foreground">No session selected</p>
          <p className="text-xs text-muted-foreground">Select or create a chat session to begin</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Active Experiment Bar */}
      <ActiveExperimentBar
        experiment={activeExperiment}
        onClear={() => setActiveExperiment(null)}
        onViewResults={handleViewResults}
        onIterate={handleIterate}
        onNewRun={handleNewRun}
      />

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4 min-w-0" ref={scrollAreaRef}>
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-2">
              <div className="text-4xl">💬</div>
              <p className="text-sm font-mono">No messages yet</p>
              <p className="text-xs">Start a conversation below</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 min-w-0">
            {messages?.map((message) => {
              // Check for special message types
              const backtestResult = isBacktestResult(message.content);

              if (backtestResult) {
                return (
                  <RunResultCard
                    key={message.id}
                    runId={backtestResult.runId}
                    strategyName={backtestResult.strategyName}
                    dateRange={backtestResult.dateRange}
                    metrics={backtestResult.metrics}
                    regime={backtestResult.regime}
                    profile={backtestResult.profile}
                    status={backtestResult.status}
                    onAudit={() => {
                      setInputValue(`/audit_run ${backtestResult.runId}`);
                    }}
                    onCompare={() => {
                      toast({
                        title: 'Compare Feature',
                        description: 'Comparison feature coming soon',
                      });
                    }}
                    onIterate={() => {
                      setInputValue('/iterate ');
                    }}
                  />
                );
              }

              // Regular message rendering
              // Detect model from content markers or metadata
              const detectModel = (msg: Message): 'gemini' | 'claude' | 'deepseek' | undefined => {
                if (msg.model) return msg.model as any;
                if (msg.content.includes('[CLAUDE CODE EXECUTION')) return 'claude';
                if (msg.content.includes('[DEEPSEEK AGENT') || msg.content.includes('DIRECT DEEPSEEK')) return 'deepseek';
                // Default to gemini for assistant messages (primary model)
                if (msg.role === 'assistant') return 'gemini';
                return undefined;
              };

              return (
                <MessageCard
                  key={message.id}
                  role={message.role as 'user' | 'assistant' | 'system'}
                  content={message.content}
                  timestamp={message.created_at}
                  model={detectModel(message)}
                />
              );
            })}

            {/* Persistent Tool Execution Log - Horizontal Swimlane (only when not loading to avoid duplication) */}
            {operationCards.length > 0 && !isLoading && (
              <div className="my-6 bg-card/50 rounded-lg border p-3">
                <div className="flex items-center gap-2 mb-3">
                  <Code className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Tool Execution Log</h3>
                  <Badge variant="secondary" className="ml-auto text-xs h-5">
                    {operationCards.length}
                  </Badge>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                  {operationCards.map(operation => (
                    <OperationCard
                      key={operation.id}
                      operation={operation}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Swarm Monitor - shows when a massive swarm job is active */}
            {activeSwarmJob && (
              <SwarmStatusBar
                jobId={activeSwarmJob.jobId}
                objective={activeSwarmJob.objective}
                progress={activeSwarmJob.progress}
                onComplete={(synthesis) => {
                  // Add synthesis result as a message
                  if (synthesis) {
                    const synthesisMessage: Message = {
                      id: `swarm-synthesis-${Date.now()}`,
                      role: 'assistant',
                      content: `## Swarm Synthesis\n\n${synthesis}`,
                      created_at: new Date().toISOString(),
                    };
                    setMessages(prev => [...prev, synthesisMessage]);
                  }
                  // Clear active swarm job
                  setActiveSwarmJob(null);
                  setIsLoading(false);
                }}
                className="mb-4"
              />
            )}

            {/* Live Agent Activity - ADHD-Friendly Clear Status */}
            {isLoading && !activeSwarmJob && (
              <div className="w-full space-y-3">
                {/* Main Status Card */}
                <div className="bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 rounded-lg px-4 py-3 w-full">
                  {/* Primary Status Header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex items-center gap-2 flex-1">
                      <div className="h-3 w-3 rounded-full bg-primary animate-pulse shadow-lg shadow-primary/50" />
                      <span className="text-sm font-semibold">
                        {toolProgress.some(p => p.type === 'executing' || p.type === 'tools-starting') 
                          ? '🔧 Running Tools...' 
                          : streamingContent
                          ? '💭 Thinking...'
                          : '⚡ Processing...'}
                      </span>
                    </div>
                    {toolProgress.filter(p => p.type === 'completed').length > 0 && (
                      <div className="text-xs bg-primary/20 px-2 py-1 rounded-full font-medium">
                        {toolProgress.filter(p => p.type === 'completed').length} / {toolProgress.filter(p => p.type === 'completed' || p.type === 'executing').length} complete
                      </div>
                    )}
                  </div>

                  {/* New Visual Enhancements */}
                  
                  {/* Decision Card */}
                  {decisionCard && (
                    <ErrorBoundary>
                      <DecisionCard
                      decision={decisionCard}
                      onProceed={() => setDecisionCard(null)}
                      onOverride={async (alternative) => {
                        if (decisionCard.id && window.electron.overrideRoutingDecision) {
                          try {
                            const result = await window.electron.overrideRoutingDecision(
                              decisionCard.id,
                              alternative
                            );
                            
                            if (result.success) {
                              toast({
                                title: 'Routing Override Applied',
                                description: `Future similar tasks will use ${alternative}`,
                              });
                            }
                          } catch (error) {
                            console.error('Override failed:', error);
                            toast({
                              title: 'Override Failed',
                              description: 'Could not apply routing override',
                              variant: 'destructive',
                            });
                          }
                        }
                        setDecisionCard(null);
                      }}
                      className="mb-4"
                    />
                    </ErrorBoundary>
                  )}

                  {/* Progress Panel */}
                  {progressPanel && (
                    <ErrorBoundary>
                      <ClaudeCodeProgressPanel
                      data={progressPanel}
                      onCancel={async () => {
                        if (window.electron?.cancelClaudeCode) {
                          await window.electron.cancelClaudeCode();
                        }
                      }}
                      className="mb-4"
                    />
                    </ErrorBoundary>
                  )}

                  {/* Evidence Chain */}
                  {evidenceChain.length > 0 && (
                    <EvidenceChain
                      nodes={evidenceChain}
                      onVerify={(nodeId) => {
                        setEvidenceChain(prev => prev.map(n =>
                          n.id === nodeId ? { ...n, verified: true } : n
                        ));
                        toast({ title: 'Evidence Verified', description: 'Marked as verified' });
                      }}
                      onViewSource={(nodeId) => {
                        const node = evidenceChain.find(n => n.id === nodeId);
                        if (node) {
                          toast({
                            title: 'View Source',
                            description: `${node.source}${node.lineRange ? ` (lines ${node.lineRange})` : ''}`,
                            duration: 5000
                          });
                        }
                      }}
                      className="mb-4"
                    />
                  )}

                  {/* Claude Code Error Card */}
                  {errorCard && (
                    <ClaudeCodeErrorCard
                      error={errorCard}
                      onRetry={() => setErrorCard(null)}
                      className="mb-4"
                    />
                  )}

                  {/* Claude Code Result Artifact (Phase 5) */}
                  {claudeCodeArtifact && (
                    <ClaudeCodeResultCard
                      artifact={claudeCodeArtifact}
                      onAccept={() => {
                        setClaudeCodeArtifact(null);
                      }}
                      onRetry={async (modifiedTask, parameters) => {
                        if (window.electron?.executeClaudeCode) {
                          try {
                            await window.electron.executeClaudeCode({
                              task: modifiedTask,
                              files: claudeCodeArtifact.executionContext?.filesTouched,
                              ...parameters,
                            });
                            setClaudeCodeArtifact(null);
                          } catch (error) {
                            console.error('Retry failed:', error);
                            toast({
                              title: 'Retry Failed',
                              description: 'Could not retry Claude Code execution',
                              variant: 'destructive',
                            });
                          }
                        }
                      }}
                      onUndo={async () => {
                        // TODO: Implement file revert logic
                        setClaudeCodeArtifact(null);
                        toast({
                          title: 'Undo Not Implemented',
                          description: 'File revert logic coming soon',
                          variant: 'destructive',
                        });
                      }}
                      className="mb-4"
                    />
                  )}
                  
                  {/* Personal Pattern Warning (Phase 7) */}
                  {personalPattern && (
                    <ContextualEducationOverlay
                      pattern={personalPattern}
                      currentContext={inputValue}
                      onDismiss={() => {
                        setPersonalPattern(null);
                        toast({
                          title: 'Pattern Noted',
                          description: "I'll watch for this pattern",
                        });
                      }}
                      onViewHistory={async () => {
                        try {
                          if (selectedWorkspaceId && window.electron?.patternGetHistory) {
                            const history = await window.electron.patternGetHistory(
                              selectedWorkspaceId
                            );
                            console.log('[Pattern History]', history);
                            toast({
                              title: 'Pattern History',
                              description: `Found ${history.length} historical patterns`,
                            });
                          }
                        } catch (error) {
                          console.error('Pattern history error:', error);
                          toast({
                            title: 'Error',
                            description: 'Failed to load pattern history',
                            variant: 'destructive',
                          });
                        }
                      }}
                    />
                  )}
                  
                  {/* Operation Cards - Only show during loading (embedded), not after (swimlane shows them) */}
                  {isLoading && operationCards.length > 0 && (
                    <div className="space-y-3 mb-4">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                        <span>Tool Executions</span>
                        <span className="text-xs bg-primary/20 px-2 py-0.5 rounded-full">
                          {operationCards.length}
                        </span>
                      </div>
                      {operationCards.map(operation => (
                        <OperationCard
                          key={operation.id}
                          operation={operation}
                        />
                      ))}
                    </div>
                  )}

                  {/* Memory Recall Toast */}
                  {memoryRecalls.length > 0 && (
                    <MemoryRecallToast
                      memories={memoryRecalls}
                      onClose={() => setMemoryRecalls([])}
                      className="mb-3"
                    />
                  )}

                  {/* Agent Spawn Monitor */}
                  {activeAgents.length > 0 && (
                    <AgentSpawnMonitor
                      agents={activeAgents}
                      className="mb-3"
                    />
                  )}

                  {/* Tool Call Tree */}
                  {toolCallTree.length > 0 && (
                    <ToolCallTree
                      calls={toolCallTree}
                      className="mb-3"
                    />
                  )}

                  {/* Operation Progress */}
                  {operationPhases.length > 0 && operationPhases.some(p => p.status !== 'pending') && (
                    <OperationProgress
                      title="Chief Quant Analysis"
                      phases={operationPhases}
                      startTime={operationStartTime}
                      className="mb-3"
                    />
                  )}

                  {/* Thinking Stream */}
                  <ThinkingStream
                    content={thinkingContent}
                    isActive={isThinking}
                    className="mb-3"
                  />

                  {/* Error Card */}
                  {currentError && (
                    <ErrorCard
                      error={currentError}
                      onRetry={() => setCurrentError(null)}
                      className="mb-3"
                    />
                  )}

                  {/* Checkpoint */}
                  {checkpoint && (
                    <WorkingMemoryCheckpoint
                      state={checkpoint}
                      onContinue={() => setCheckpoint(null)}
                      onSaveAndExit={() => console.log('Save and exit')}
                      onAbandon={() => setCheckpoint(null)}
                      className="mb-3"
                    />
                  )}

                  {/* Streaming Response */}
                  {streamingContent && (
                    <div className="bg-background/50 rounded p-3 mb-3">
                      <div className="text-sm whitespace-pre-wrap">
                        {streamingContent}
                        <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 rounded-sm" />
                      </div>
                    </div>
                  )}

                  {/* Tool Progress - Simple, Visual, Always Visible */}
                  {toolProgress.length > 0 && (
                    <div className="space-y-2">
                      {/* Active Tool Execution */}
                      {toolProgress.filter(p => p.type === 'executing').slice(-3).map((progress, idx) => (
                        <div key={`exec-${idx}`} className="bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin text-yellow-500 flex-shrink-0" />
                            <span className="text-sm font-medium flex-1">{progress.tool}</span>
                            <Badge variant="secondary" className="text-xs">running</Badge>
                          </div>
                          {progress.args && Object.keys(progress.args).length > 0 && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              <pre className="whitespace-pre-wrap break-words font-mono">
                                {JSON.stringify(progress.args, null, 2).slice(0, 150)}
                                {JSON.stringify(progress.args).length > 150 && '...'}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                      
                      {/* Recently Completed Tools */}
                      {toolProgress.filter(p => p.type === 'completed').slice(-3).map((progress, idx) => (
                        <div key={`done-${idx}`} className={cn(
                          "rounded px-3 py-2 transition-all",
                          progress.success 
                            ? "bg-green-500/10 border border-green-500/20" 
                            : "bg-red-500/10 border border-red-500/20"
                        )}>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "flex-shrink-0",
                              progress.success ? "text-green-500" : "text-red-500"
                            )}>
                              {progress.success ? '✓' : '✗'}
                            </span>
                            <span className="text-sm font-medium flex-1">{progress.tool}</span>
                            <Badge 
                              variant={progress.success ? "default" : "destructive"} 
                              className="text-xs"
                            >
                              {progress.success ? 'done' : 'error'}
                            </Badge>
                          </div>
                          {progress.preview && (
                            <div className="mt-2 text-xs">
                              <pre className="whitespace-pre-wrap break-words font-mono text-muted-foreground max-h-20 overflow-y-auto">
                                {progress.preview}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Tool Summary Line */}
                      {toolProgress.filter(p => p.type === 'completed').length > 3 && (
                        <div className="text-xs text-center text-muted-foreground pt-2 border-t border-border">
                          + {toolProgress.filter(p => p.type === 'completed').length - 3} more tools completed
                        </div>
                      )}
                    </div>
                  )}

                  {/* Initial Loading State */}
                  {!streamingContent && toolProgress.length === 0 && (
                    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Starting up...</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border p-2 min-w-0">
        {/* Contextual Suggestions */}
        {showContextualSuggestions && (
          <CommandSuggestions
            suggestions={getSuggestions(appState)}
            onSelect={(command) => {
              setInputValue(command);
              setShowContextualSuggestions(false);
            }}
            onDismiss={() => setShowContextualSuggestions(false)}
          />
        )}

        {/* Intent Suggestion Bar */}
        {intentSuggestion && !inputValue.startsWith('/') && (
          <div className="mb-2 flex items-center gap-2 p-2 bg-blue-500/10 rounded border border-blue-500/20 min-w-0">
            <span className="text-xs text-blue-400">💡</span>
            <span className="text-xs flex-1 min-w-0">
              <span className="text-muted-foreground">Did you mean:</span>{' '}
              <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-blue-300 break-all">
                {intentSuggestion.suggestion}
              </code>
              {intentSuggestion.explanation && (
                <span className="text-muted-foreground ml-2">({intentSuggestion.explanation})</span>
              )}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/20"
              onClick={() => {
                setInputValue(intentSuggestion.suggestion);
                setIntentSuggestion(null);
              }}
            >
              Use this
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs hover:bg-muted/50"
              onClick={() => setIntentSuggestion(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Command Suggestions */}
        {commandSuggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1 min-w-0">
            {commandSuggestions.slice(0, 5).map(suggestion => (
              <button
                key={suggestion}
                onClick={() => setInputValue(suggestion + ' ')}
                className="text-xs px-2 py-1 rounded bg-accent hover:bg-accent/80 font-mono transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 min-w-0">
          {/* Demo Mode Button - always available for testing */}
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-xs"
            onClick={runDemoConversation}
            disabled={isLoading}
            title="Test the ADHD-friendly conversation UI improvements"
          >
            🎬 Demo
          </Button>
          
          <Popover open={showCommandMenu} onOpenChange={setShowCommandMenu}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                disabled={isLoading || !selectedSessionId}
              >
                <Slash className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent 
              className="w-96 p-0 bg-background border-border z-50" 
              align="start"
              side="top"
            >
              <div className="p-3 border-b border-border bg-muted/50">
                <h3 className="font-semibold text-sm font-mono flex items-center gap-2">
                  <Command className="h-4 w-4" />
                  Slash Commands ({Object.keys(commands).length})
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Click any command to insert it into the chat
                </p>
              </div>
              <ScrollArea className="h-[400px]">
                <div className="p-2 space-y-1">
                  {Object.values(commands).map((cmd) => (
                    <button
                      key={cmd.name}
                      onClick={() => {
                        setInputValue(cmd.usage);
                        setShowCommandMenu(false);
                      }}
                      className="w-full text-left p-3 rounded hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
                    >
                      <div className="font-mono text-sm font-semibold text-primary">
                        /{cmd.name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {cmd.description}
                      </div>
                      <div className="text-xs font-mono text-accent-foreground mt-1 opacity-70">
                        {cmd.usage}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
          
          <Textarea
            placeholder="Type your message or use /help for commands... (Shift+Enter for new line)"
            className="resize-none font-mono text-sm flex-1 min-w-0"
            rows={2}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isLoading || !selectedSessionId}
          />
          <Button
            size="icon"
            className="shrink-0"
            onClick={sendMessage}
            disabled={isLoading || !inputValue.trim() || !selectedSessionId}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground font-mono">
          {isLoading
            ? '⏳ Processing... (Press ESC to cancel)'
            : '🎬 Click Demo button to test the ADHD-friendly UI improvements'}
        </div>
      </div>
      
      {/* Write Confirmation Dialog */}
      <ConfirmationDialog />
    </div>
  );
};

export const ChatArea = () => (
  <ErrorBoundary>
    <ChatAreaComponent />
  </ErrorBoundary>
);
