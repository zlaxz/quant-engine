import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Send, Loader2, Command, Slash } from 'lucide-react';
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
} from '@/lib/displayDirectiveParser';

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export const ChatArea = () => {
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
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
        .select('id, role, content, created_at')
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

    // Subscribe to tool progress
    const unsubscribeTool = window.electron.onToolProgress((data) => {
      setToolProgress(prev => [...prev, data]);
    });

    // Subscribe to LLM streaming
    const unsubscribeStream = window.electron.onLLMStream((data) => {
      if (data.type === 'chunk' && data.content) {
        setStreamingContent(prev => prev + data.content);
        setIsStreaming(true);
      } else if (data.type === 'thinking' && data.content) {
        // Show thinking/reasoning text in italics
        setStreamingContent(prev => prev + data.content);
        setIsStreaming(true);
      } else if (data.type === 'done') {
        setIsStreaming(false);
        // Clear streaming content after it's shown in final message
        setTimeout(() => setStreamingContent(''), 100);
      } else if (data.type === 'error') {
        setIsStreaming(false);
        setStreamingContent('');
      } else if (data.type === 'cancelled') {
        // Request was cancelled by user
        setIsStreaming(false);
        setStreamingContent('');
        setToolProgress([]);
      } else if (data.type === 'clear-hallucinated') {
        // Gemini hallucinated tool calls - clear fake response and show notification
        // This happens when Gemini returns text instead of functionCall parts
        console.log('[ChatArea] Clearing hallucinated response, executing real tools...');
        setStreamingContent(data.content || '*Executing real tool calls...*\n\n');
        setIsStreaming(true);
      }
    });

    return () => {
      unsubscribeTool();
      unsubscribeStream();
    };
  }, []);

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
        }

        // Parse artifact directive (if present)
        const artifact = parseArtifactDirective(response.content);
        if (artifact) {
          console.log('[ChatArea] Parsed artifact directive:', artifact);
          displayContext.showArtifact(artifact);
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
      toast({
        title: 'Error',
        description: error.message || 'Failed to send message',
        variant: 'destructive',
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
            {messages.map((message) => {
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
              return (
                <div
                  key={message.id}
                  className="min-w-0"
                >
                  <div
                    className={cn(
                      'rounded-lg px-4 py-2 whitespace-pre-wrap chat-message',
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : message.role === 'assistant'
                        ? 'bg-muted'
                        : 'bg-accent/50 text-accent-foreground border border-accent'
                    )}
                  >
                    {message.role === 'system' && (
                      <div className="flex items-center gap-2 mb-1 text-xs font-mono opacity-70">
                        <Command className="h-3 w-3" />
                        {message.content.startsWith('Command:') ? 'Slash Command' : 'System'}
                      </div>
                    )}
                    <div className="text-sm chat-message">{message.content}</div>
                    <div className="text-xs opacity-50 mt-1">
                      {new Date(message.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              );
            })}

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

            {/* Live Agent Activity - Streaming, Tools, Thinking */}
            {isLoading && !activeSwarmJob && (
              <div className="w-full">
                <div className="bg-muted rounded-lg px-4 py-3 w-full">
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-xs font-medium text-muted-foreground">Agent Working</span>
                    {toolProgress.filter(p => p.type === 'completed').length > 0 && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {toolProgress.filter(p => p.type === 'completed').length} tools executed
                      </span>
                    )}
                  </div>

                  {/* Streaming content - main response text */}
                  {streamingContent && (
                    <div className="text-sm mb-3 whitespace-pre-wrap">
                      {streamingContent}
                      <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-1" />
                    </div>
                  )}

                  {/* Tool progress - collapsible activity log */}
                  {toolProgress.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <details open className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground font-medium mb-1">
                          Tool Activity ({toolProgress.length} events)
                        </summary>
                        <div className="space-y-1 mt-1 max-h-40 overflow-y-auto font-mono text-muted-foreground">
                          {toolProgress.map((progress, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                              {progress.type === 'thinking' && (
                                <span>• {progress.message || 'Processing...'}</span>
                              )}
                              {progress.type === 'tools-starting' && (
                                <span>• Starting {progress.count} tool(s)</span>
                              )}
                              {progress.type === 'executing' && (
                                <span>
                                  <span className="animate-pulse">→</span> {progress.tool}
                                  <span className="opacity-60 ml-1">
                                    ({Object.entries(progress.args || {}).map(([k,v]) => `${k}="${String(v).slice(0,20)}${String(v).length > 20 ? '...' : ''}"`).join(', ')})
                                  </span>
                                </span>
                              )}
                              {progress.type === 'completed' && (
                                <span className={progress.success ? 'text-foreground' : 'text-destructive'}>
                                  {progress.success ? '✓' : '✗'} {progress.tool}
                                  <span className="opacity-60 ml-1 text-[10px]">
                                    {progress.preview?.slice(0, 60)}...
                                  </span>
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}

                  {/* Fallback spinner when no content yet */}
                  {!streamingContent && toolProgress.length === 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Processing...</span>
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
            : inputValue.startsWith('/')
            ? '🎮 Slash command mode - Press Enter to execute'
            : 'Type /help for available commands'}
        </div>
      </div>
      
      {/* Write Confirmation Dialog */}
      <ConfirmationDialog />
    </div>
  );
};
