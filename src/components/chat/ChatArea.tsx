/**
 * ChatArea - Simplified conversation thread
 * 
 * Moderate refactor: Removed Terminal-redundant transparency UI
 * since Claude Code execution is visible in Terminal window.
 * 
 * KEPT: Messages, errors, results, memory, streaming
 * REMOVED: AgentSpawnMonitor, ToolCallTree, ThinkingStream, OperationCard,
 *          OperationProgress, DecisionCard, EvidenceChain, WorkingMemoryCheckpoint,
 *          ClaudeCodeProgressPanel (all visible in Terminal)
 */

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
import { executeCommand, parseCommand, getCommandSuggestions, setWriteConfirmationCallback } from '@/lib/slashCommands';
import { useWriteConfirmation } from '@/hooks/useWriteConfirmation';
import { useMemoryReinforcement } from '@/hooks/useMemoryReinforcement';
import { chatPrimary } from '@/lib/electronClient';
import { buildChiefQuantPrompt } from '@/prompts/chiefQuantPrompt';
import { detectIntent, type DetectedIntent } from '@/lib/intentDetector';
import { ActiveExperimentBar } from './ActiveExperimentBar';
import { MessageCard } from './MessageCard';
import { SwarmStatusBar } from '@/components/swarm';
import { getJobProgress, type SwarmProgress } from '@/lib/swarmClient';
import {
  stripDisplayDirectives,
  parseChartDirective,
  parseTableDirective,
  parseMetricsDirective,
  parseCodeDirective,
  parseUpdateChartDirective,
  parseNotificationDirective,
} from '@/lib/displayDirectiveParser';
import {
  ErrorCard,
  MemoryRecallToast,
  ClaudeCodeErrorCard,
  ClaudeCodeResultCard,
  ContextualEducationOverlay,
  ClaudeCodePendingPreview,
  type ErrorDetails,
  type Memory,
  type ClaudeCodeError,
  type PersonalPattern,
  type PendingClaudeCodeCommand,
} from '@/components/research';
import { ClaudeCodeArtifact } from '@/types/api-contract';

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
  model?: string;
}

const ChatAreaComponent = () => {
  const { selectedSessionId, selectedWorkspaceId, activeExperiment, setActiveExperiment } = useChatContext();
  const displayContext = useResearchDisplay();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [commandSuggestions, setCommandSuggestions] = useState<string[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [intentSuggestion, setIntentSuggestion] = useState<DetectedIntent | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeSwarmJob, setActiveSwarmJob] = useState<{
    jobId: string;
    objective: string;
    progress: SwarmProgress;
  } | null>(null);
  const [cachedMemoryContext, setCachedMemoryContext] = useState<string | null>(null);
  
  // Simplified state - kept only essential UI elements
  const [errorCard, setErrorCard] = useState<ClaudeCodeError | null>(null);
  const [claudeCodeArtifact, setClaudeCodeArtifact] = useState<ClaudeCodeArtifact | null>(null);
  const [personalPattern, setPersonalPattern] = useState<PersonalPattern | null>(null);
  const [currentError, setCurrentError] = useState<ErrorDetails | null>(null);
  const [memoryRecalls, setMemoryRecalls] = useState<Memory[]>([]);
  
  // Pending Claude Code commands awaiting user approval
  const [pendingCommand, setPendingCommand] = useState<PendingClaudeCodeCommand | null>(null);
  
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Function to save messages with retry logic
  const saveMessagesToDb = async (messages: any[]): Promise<boolean> => {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const { error } = await supabase.from('messages').insert(messages);
      if (!error) return true;
      lastError = error;
      if (attempt < maxRetries) {
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
  
  const { showConfirmation, ConfirmationDialog } = useWriteConfirmation();
  useMemoryReinforcement();

  useEffect(() => {
    setWriteConfirmationCallback(showConfirmation);
    return () => setWriteConfirmationCallback(undefined);
  }, [showConfirmation]);

  const loadMessages = useCallback(async () => {
    if (!selectedSessionId) return;

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id, role, content, created_at, model, provider')
        .eq('session_id', selectedSessionId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);

      if (data && selectedWorkspaceId) {
        // Messages loaded successfully
      }
    } catch (error: any) {
      console.error('Error loading messages:', error);
      toast({
        title: 'Error',
        description: 'Failed to load messages',
        variant: 'destructive',
      });
    }
  }, [selectedSessionId, selectedWorkspaceId, toast]);

  // Subscribe to IPC events for streaming (Electron only)
  useEffect(() => {
    if (!window.electron?.onLLMStream) return;

    const unsubscribeStream = window.electron.onLLMStream((data) => {
      if (data.type === 'chunk' && data.content) {
        setStreamingContent(prev => prev + data.content);
      } else if (data.type === 'done') {
        setTimeout(() => setStreamingContent(''), 100);
      } else if (data.type === 'cancelled') {
        setIsLoading(false);
      }
    });

    return () => unsubscribeStream();
  }, []);

  // Listen for Claude Code directive emissions
  useEffect(() => {
    if (!window.electron?.onClaudeCodeDirectives) return;

    const unsubDirectives = window.electron.onClaudeCodeDirectives((event) => {
      // Process directives for visualizations
      event.directives.forEach((directive: any) => {
        try {
          if (directive.type === 'stage') {
            displayContext.updateStage(directive.value);
          } else if (directive.type === 'display') {
            displayContext.showVisualization(directive.value, directive.params);
          } else if (directive.type === 'progress') {
            displayContext.updateProgress(parseInt(directive.value), directive.params?.message);
          } else if (directive.type === 'hide') {
            displayContext.hideAllVisualizations();
          }
        } catch (error) {
          console.error('[ChatArea] Failed to process directive:', directive.type, error);
        }
      });

      // Parse data-driven directives
      const fullOutput = event.rawOutput || '';
      const chartDir = parseChartDirective(fullOutput);
      if (chartDir) displayContext.showChart(chartDir);
      const tableDir = parseTableDirective(fullOutput);
      if (tableDir) displayContext.showTable(tableDir);
      const metricsDir = parseMetricsDirective(fullOutput);
      if (metricsDir) displayContext.showMetrics(metricsDir);
      const codeDir = parseCodeDirective(fullOutput);
      if (codeDir) displayContext.showCode(codeDir);
      const updateChartDir = parseUpdateChartDirective(fullOutput);
      if (updateChartDir) displayContext.updateChart(updateChartDir.id, updateChartDir as any);
      const notificationDir = parseNotificationDirective(fullOutput);
      if (notificationDir) {
        toast({
          title: 'Notification',
          description: notificationDir.message,
          variant: notificationDir.type === 'error' ? 'destructive' : 'default',
        });
      }
    });

    return () => unsubDirectives();
  }, [toast]);

  // Listen for Claude Code events (errors and results only)
  useEffect(() => {
    if (!window.electron?.onClaudeCodeEvent) return;

    const unsubClaudeEvents = window.electron.onClaudeCodeEvent((event: {
      type: 'decision' | 'progress' | 'error' | 'checkpoint' | 'complete' | 'cancelled';
      data: unknown;
    }) => {
      if (event.type === 'complete') {
        toast({
          title: 'Claude Code Complete',
          description: 'Task completed successfully',
        });
      } else if (event.type === 'cancelled') {
        toast({
          title: 'Execution Cancelled',
          description: (event.data as any).message || 'Claude Code execution was cancelled',
          variant: 'destructive',
        });
      } else if (event.type === 'error') {
        setErrorCard(event.data as ClaudeCodeError);
      }
    });

    return () => unsubClaudeEvents();
  }, [toast]);

  // Listen for pending Claude Code commands awaiting approval
  useEffect(() => {
    if (!window.electron?.onClaudeCodePending) return;

    const unsubPending = window.electron.onClaudeCodePending((command) => {
      setPendingCommand({
        id: command.id,
        task: command.task,
        context: command.context,
        files: command.files,
        parallelHint: command.parallelHint as 'none' | 'minor' | 'massive' | undefined,
        timestamp: command.timestamp,
      });
      
      toast({
        title: '⚠️ Claude Code Approval Required',
        description: 'Review the command before execution',
      });
    });

    return () => unsubPending();
  }, [toast]);

  // Handle approve/reject for pending commands
  const handleApproveCommand = async (commandId: string) => {
    if (window.electron?.approveClaudeCodeCommand) {
      await window.electron.approveClaudeCodeCommand(commandId);
      setPendingCommand(null);
      toast({
        title: 'Command Approved',
        description: 'Executing via Claude Code...',
      });
    }
  };

  const handleRejectCommand = async (commandId: string) => {
    if (window.electron?.rejectClaudeCodeCommand) {
      await window.electron.rejectClaudeCodeCommand(commandId);
      setPendingCommand(null);
      toast({
        title: 'Command Rejected',
        description: 'Claude Code execution cancelled',
        variant: 'destructive',
      });
    }
  };

  // Clear transient UI when starting new user message
  useEffect(() => {
    if (isLoading && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === 'user') {
        setErrorCard(null);
        setClaudeCodeArtifact(null);
        setMemoryRecalls([]);
        setCurrentError(null);
      }
    }
  }, [isLoading, messages]);

  // ESC key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isLoading) {
        e.preventDefault();
        if (window.electron?.cancelRequest) {
          window.electron.cancelRequest().then(() => {
            toast({ title: 'Request Cancelled', description: 'Stopped by ESC key' });
            setIsLoading(false);
            setStreamingContent('');
          }).catch(console.error);
        } else {
          setIsLoading(false);
          setStreamingContent('');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, toast]);

  // Load messages when session changes
  useEffect(() => {
    if (selectedSessionId) {
      loadMessages();
      displayContext.resetState();
      setCachedMemoryContext(null);
    } else {
      setMessages([]);
      setCachedMemoryContext(null);
    }
  }, [selectedSessionId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Update command suggestions
  useEffect(() => {
    if (inputValue.startsWith('/')) {
      setCommandSuggestions(getCommandSuggestions(inputValue));
      setIntentSuggestion(null);
    } else {
      setCommandSuggestions([]);
      const intent = detectIntent(inputValue);
      setIntentSuggestion(intent && intent.confidence >= 0.7 ? intent : null);
    }
  }, [inputValue]);

  const sendMessage = async () => {
    if (!inputValue.trim() || !selectedSessionId || !selectedWorkspaceId) return;

    const messageContent = inputValue.trim();
    setInputValue('');
    setCommandSuggestions([]);
    setStreamingContent('');
    setIsLoading(true);

    try {
      const parsed = parseCommand(messageContent);
      
      if (parsed) {
        // Execute slash command
        const result = await executeCommand(messageContent, {
          sessionId: selectedSessionId,
          workspaceId: selectedWorkspaceId,
          setActiveExperiment,
        });

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

        if (result.success && parsed) {
          // Check for swarm job
          if (result.data?.jobId && result.data?.mode) {
            try {
              const swarmJobData = JSON.parse(result.message);
              if (swarmJobData.type === 'swarm_job') {
                const initialProgress = await getJobProgress(result.data.jobId);
                setActiveSwarmJob({
                  jobId: result.data.jobId,
                  objective: swarmJobData.objective || `Swarm: ${result.data.mode}`,
                  progress: initialProgress,
                });
              }
            } catch { /* Not a swarm job */ }
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
        // Regular chat message
        
        // Pattern detection
        if (selectedWorkspaceId && window.electron?.patternDetect) {
          try {
            const result = await window.electron.patternDetect(selectedWorkspaceId, messageContent);
            if (result.pattern && result.confidence > 0.7) {
              setPersonalPattern(result.pattern);
            }
          } catch { /* Continue */ }
        }

        // Add user message
        const userMessage: Message = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: messageContent,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, userMessage]);

        // Memory context (cached per session)
        const basePrompt = buildChiefQuantPrompt();
        let memoryContext = cachedMemoryContext || '';

        if (!cachedMemoryContext && selectedWorkspaceId && window.electron?.memoryRecall) {
          try {
            const recallResult = await window.electron.memoryRecall(
              messageContent.slice(0, 500),
              selectedWorkspaceId,
              { limit: 10, minImportance: 0.4, useCache: true, rerank: false }
            );

            if (recallResult?.memories?.length > 0) {
              memoryContext = await window.electron.memoryFormatForPrompt(recallResult.memories);
              setCachedMemoryContext(memoryContext);
              toast({
                title: '🧠 Memory Loaded',
                description: `${recallResult.memories.length} memories cached`,
              });
            }
          } catch (e) {
            console.error('[ChatArea] Memory recall failed:', e);
          }
        }

        // Build LLM messages
        const sessionContext = `\n\n## Current Session Context\n**Session ID:** ${selectedSessionId}`;
        const enrichedSystemPrompt = `${basePrompt}\n\n${memoryContext}${sessionContext}`;

        // Truncate history if needed
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

        // Call LLM
        let assistantContent = '';
        try {
          const response = await chatPrimary(llmMessages);
          assistantContent = response.content || '';

          // Parse directives from response
          const chartDir = parseChartDirective(assistantContent);
          if (chartDir) displayContext.showChart(chartDir);
          const tableDir = parseTableDirective(assistantContent);
          if (tableDir) displayContext.showTable(tableDir);
          const metricsDir = parseMetricsDirective(assistantContent);
          if (metricsDir) displayContext.showMetrics(metricsDir);
          const codeDir = parseCodeDirective(assistantContent);
          if (codeDir) displayContext.showCode(codeDir);

          // Strip directives from display
          const cleanContent = stripDisplayDirectives(assistantContent);

          const assistantMessage: Message = {
            id: `asst-${Date.now()}`,
            role: 'assistant',
            content: cleanContent,
            created_at: new Date().toISOString(),
            model: response.model || 'gemini',
          };
          setMessages(prev => [...prev, assistantMessage]);

          // Save to database
          await saveMessagesToDb([
            {
              session_id: selectedSessionId,
              role: 'user',
              content: messageContent,
              model: null,
              provider: null
            },
            {
              session_id: selectedSessionId,
              role: 'assistant',
              content: cleanContent,
              model: response.model || 'gemini',
              provider: response.provider || 'google'
            }
          ]);

        } catch (llmError: any) {
          console.error('[ChatArea] LLM call failed:', llmError);
          setCurrentError({
            message: llmError.message || 'Failed to get response',
            code: 'LLM_ERROR',
          });
          toast({
            title: 'Error',
            description: llmError.message || 'Failed to get response from AI',
            variant: 'destructive',
          });
        }
      }
    } catch (error: any) {
      console.error('[ChatArea] sendMessage error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Active Experiment Bar */}
      {activeExperiment && (
        <ActiveExperimentBar
          experiment={activeExperiment}
          onClear={() => setActiveExperiment(null)}
          onViewResults={() => {
            if (activeExperiment.lastRunId) {
              setInputValue(`/runs view:${activeExperiment.lastRunId}`);
            }
          }}
          onIterate={() => {
            setInputValue(`/backtest strategy:${activeExperiment.strategy}`);
          }}
          onNewRun={() => {
            setInputValue(`/backtest strategy:${activeExperiment.strategy}`);
          }}
        />
      )}

      {/* Swarm Status Bar */}
      {activeSwarmJob && (
        <SwarmStatusBar
          jobId={activeSwarmJob.jobId}
          objective={activeSwarmJob.objective}
          progress={activeSwarmJob.progress}
          onComplete={(synthesis) => {
            toast({
              title: 'Swarm Complete',
              description: synthesis ? 'Results synthesized' : 'Job finished',
            });
            setActiveSwarmJob(null);
          }}
        />
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 overflow-y-auto" ref={scrollAreaRef}>
        {!selectedSessionId ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Select or create a chat session to get started</p>
          </div>
        ) : (
          <div className="py-4 space-y-1">
            {messages.map((message) => {
              return (
                <MessageCard
                  key={message.id}
                  role={message.role as 'user' | 'assistant' | 'system'}
                  content={message.content}
                  timestamp={message.created_at}
                  model={message.model as any}
                />
              );
            })}

            {/* Pending Claude Code Command - Requires Approval */}
            {pendingCommand && (
              <div className="mb-4">
                <ClaudeCodePendingPreview
                  command={pendingCommand}
                  onApprove={handleApproveCommand}
                  onReject={handleRejectCommand}
                />
              </div>
            )}

            {/* Loading State */}
            {isLoading && (
              <div className="p-4 rounded-lg border border-border bg-muted/30">
                <div className="flex items-center gap-3 mb-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="font-medium">Processing...</span>
                  <Badge variant="outline" className="text-xs">ESC to cancel</Badge>
                </div>

                {/* Claude Code Error */}
                {errorCard && (
                  <ClaudeCodeErrorCard
                    error={errorCard}
                    onRetry={() => setErrorCard(null)}
                    className="mb-4"
                  />
                )}

                {/* Claude Code Result */}
                {claudeCodeArtifact && (
                  <ClaudeCodeResultCard
                    artifact={claudeCodeArtifact}
                    onAccept={() => setClaudeCodeArtifact(null)}
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
                          toast({
                            title: 'Retry Failed',
                            description: 'Could not retry Claude Code execution',
                            variant: 'destructive',
                          });
                        }
                      }
                    }}
                    onUndo={async () => {
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

                {/* Personal Pattern Warning */}
                {personalPattern && (
                  <ContextualEducationOverlay
                    pattern={personalPattern}
                    currentContext={inputValue}
                    onDismiss={() => setPersonalPattern(null)}
                    onViewHistory={async () => {
                      if (selectedWorkspaceId && window.electron?.patternGetHistory) {
                        const history = await window.electron.patternGetHistory(selectedWorkspaceId);
                        toast({
                          title: 'Pattern History',
                          description: `Found ${history.length} patterns`,
                        });
                      }
                    }}
                  />
                )}

                {/* Memory Recalls */}
                {memoryRecalls.length > 0 && (
                  <MemoryRecallToast
                    memories={memoryRecalls}
                    onClose={() => setMemoryRecalls([])}
                    className="mb-3"
                  />
                )}

                {/* General Error */}
                {currentError && (
                  <ErrorCard
                    error={currentError}
                    onRetry={() => setCurrentError(null)}
                    className="mb-3"
                  />
                )}

                {/* Streaming Response */}
                {streamingContent && (
                  <div className="bg-background/50 rounded p-3">
                    <div className="text-sm whitespace-pre-wrap">
                      {streamingContent}
                      <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 rounded-sm" />
                    </div>
                  </div>
                )}

                {/* Initial Loading */}
                {!streamingContent && (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Starting up...</span>
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border p-2 min-w-0">
        {/* Intent Suggestion */}
        {intentSuggestion && !inputValue.startsWith('/') && (
          <div className="mb-2 flex items-center gap-2 p-2 bg-blue-500/10 rounded border border-blue-500/20">
            <span className="text-xs text-blue-400">💡</span>
            <span className="text-xs flex-1">
              <span className="text-muted-foreground">Did you mean:</span>{' '}
              <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-blue-300">
                {intentSuggestion.suggestion}
              </code>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-blue-400"
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
              className="h-6 px-2 text-xs"
              onClick={() => setIntentSuggestion(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Command Menu */}
        {commandSuggestions.length > 0 && inputValue.startsWith('/') && (
          <div className="mb-2 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
            {commandSuggestions.map((cmd) => (
              <button
                key={cmd}
                className="w-full text-left px-3 py-2 hover:bg-muted text-sm font-mono"
                onClick={() => {
                  setInputValue(cmd + ' ');
                  setCommandSuggestions([]);
                }}
              >
                {cmd}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0 relative">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message or /command..."
              className="min-h-[40px] max-h-[200px] resize-none pl-10 pr-10"
              disabled={isLoading || !selectedSessionId}
            />
            {/* Command menu trigger inside input */}
            <Popover open={showCommandMenu} onOpenChange={setShowCommandMenu}>
              <PopoverTrigger asChild>
                <button 
                  className="absolute left-2.5 top-2.5 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Quick commands"
                >
                  <Slash className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start" sideOffset={8}>
                <div className="text-xs font-medium text-muted-foreground mb-2">Quick Commands</div>
                <div className="space-y-0.5">
                  {['/backtest', '/runs', '/compare', '/note', '/help'].map((cmd) => (
                    <button
                      key={cmd}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-accent text-sm font-mono"
                      onClick={() => {
                        setInputValue(cmd + ' ');
                        setShowCommandMenu(false);
                      }}
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {/* Status icons */}
            {inputValue.startsWith('/') && (
              <Command className="absolute right-3 top-3 h-4 w-4 text-primary" />
            )}
            {inputValue.includes('```') && (
              <Code className="absolute right-3 top-3 h-4 w-4 text-amber-500" />
            )}
          </div>

          <Button
            onClick={sendMessage}
            disabled={!inputValue.trim() || isLoading || !selectedSessionId}
            size="icon"
            className="h-10 w-10 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 mt-1.5 text-[11px] text-muted-foreground">
          <span>↵ send</span>
          <span>⇧↵ newline</span>
          <span>esc cancel</span>
        </div>
      </div>

      <ConfirmationDialog />
    </div>
  );
};

export const ChatArea = ChatAreaComponent;
