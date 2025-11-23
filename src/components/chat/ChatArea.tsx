import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Send, Loader2, Command, Slash, Wrench } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useChatContext } from '@/contexts/ChatContext';
import { cn } from '@/lib/utils';
import { executeCommand, parseCommand, getCommandSuggestions, commands, setWriteConfirmationCallback } from '@/lib/slashCommands';
import { useWriteConfirmation } from '@/hooks/useWriteConfirmation';
import { chatPrimary } from '@/lib/electronClient';
import { buildChiefQuantPrompt } from '@/prompts/chiefQuantPrompt';

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export const ChatArea = () => {
  const { selectedSessionId, selectedWorkspaceId } = useChatContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMessages, setIsFetchingMessages] = useState(false);
  const [commandSuggestions, setCommandSuggestions] = useState<string[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Write confirmation hook
  const { showConfirmation, ConfirmationDialog } = useWriteConfirmation();
  
  // Set global confirmation callback for slash commands
  useEffect(() => {
    setWriteConfirmationCallback(showConfirmation);
    return () => setWriteConfirmationCallback(undefined);
  }, [showConfirmation]);

  // Load messages when session changes
  useEffect(() => {
    if (selectedSessionId) {
      loadMessages();
    } else {
      setMessages([]);
    }
  }, [selectedSessionId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Update command suggestions when input changes
  useEffect(() => {
    if (inputValue.startsWith('/')) {
      const suggestions = getCommandSuggestions(inputValue);
      setCommandSuggestions(suggestions);
    } else {
      setCommandSuggestions([]);
    }
  }, [inputValue]);

  const loadMessages = async () => {
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
  };

  const sendMessage = async () => {
    if (!inputValue.trim() || !selectedSessionId || !selectedWorkspaceId) return;

    const messageContent = inputValue.trim();
    setInputValue('');
    setCommandSuggestions([]);
    setIsLoading(true);

    try {
      // Check if this is a slash command
      const parsed = parseCommand(messageContent);
      
      if (parsed) {
        // Execute slash command
        const result = await executeCommand(messageContent, {
          sessionId: selectedSessionId,
          workspaceId: selectedWorkspaceId,
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

        // Build messages array for LLM (Chief Quant system prompt + history + new message)
        // Truncate history to stay within context limits (~100k tokens ≈ 400k chars)
        const MAX_HISTORY_CHARS = 400000;
        let historyMessages = messages.map(m => ({ role: m.role, content: m.content }));

        // Calculate total chars and truncate from the beginning if needed
        let totalChars = historyMessages.reduce((sum, m) => sum + m.content.length, 0);
        while (totalChars > MAX_HISTORY_CHARS && historyMessages.length > 0) {
          const removed = historyMessages.shift();
          if (removed) totalChars -= removed.content.length;
        }

        const llmMessages = [
          { role: 'system', content: buildChiefQuantPrompt() },
          ...historyMessages,
          { role: 'user', content: messageContent }
        ];

        // Call LLM via Electron IPC (removed - now using direct params)
        const response = await chatPrimary({
          sessionId: selectedSessionId,
          workspaceId: selectedWorkspaceId,
          content: messageContent
        });

        // Add assistant response to UI
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.content,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMessage]);

        // Save both messages to database (background, non-blocking but notify on failure)
        supabase.from('messages').insert([
          { session_id: selectedSessionId, role: 'user', content: messageContent },
          { session_id: selectedSessionId, role: 'assistant', content: response.content, provider: response.provider, model: response.model }
        ]).then(({ error }) => {
          if (error) {
            console.error('Error saving messages to DB:', error);
            toast({
              title: 'Save Warning',
              description: 'Messages displayed but failed to save to database. They may not persist.',
              variant: 'destructive',
            });
          }
        });
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
    <div className="flex-1 flex flex-col h-full">
      {/* Header with Sidebar Toggle */}
      <div className="border-b border-border p-4 flex items-center gap-3">
        <SidebarTrigger />
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-mono">Chat Session</h2>
          <p className="text-sm text-muted-foreground">
            {isFetchingMessages ? 'Loading messages...' : `${messages.length} messages`}
          </p>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-2">
              <div className="text-4xl">💬</div>
              <p className="text-sm font-mono">No messages yet</p>
              <p className="text-xs">Start a conversation below</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className="w-full"
              >
                <div
                  className={cn(
                    'w-full rounded-lg px-4 py-2 whitespace-pre-wrap',
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
                  <div className="text-sm">{message.content}</div>
                  <div className="text-xs opacity-50 mt-1">
                    {new Date(message.created_at).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {/* Thinking/Tool indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-3 max-w-[80%]">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="font-mono">Thinking...</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground/70 mt-1">
                    <Wrench className="h-3 w-3" />
                    <span className="font-mono">Tools available: file, git, validation, analysis</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border p-2">
        {/* Command Suggestions */}
        {commandSuggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
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
        
        <div className="flex gap-2">
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
            className="resize-none font-mono text-sm"
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
            ? 'Processing...' 
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
