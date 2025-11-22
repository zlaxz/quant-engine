import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, HelpCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface HelperChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelperChatDialog({ open, onOpenChange }: HelperChatDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('helper-chat', {
        body: { messages: newMessages }
      });

      if (error) throw error;
      if (!data?.response) throw new Error('Invalid response from helper');

      setMessages([...newMessages, { role: 'assistant', content: data.response }]);
    } catch (error) {
      console.error('Helper chat error:', error);
      toast.error('Failed to get response from helper');
      // Remove the user message if we failed
      setMessages(messages);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            Getting Started Helper
          </DialogTitle>
          <DialogDescription>
            Ask me anything about how to use the Quant Chat Workbench effectively.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>👋 Hi! I'm here to help you get started with the Quant Chat Workbench.</p>
                <p className="font-medium">Try asking:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>"What slash commands should I know?"</li>
                  <li>"How do I run and compare backtests?"</li>
                  <li>"What's the best workflow for research?"</li>
                  <li>"How does the memory system work?"</li>
                  <li>"What are the agent modes?"</li>
                </ul>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`rounded-lg p-3 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground ml-8'
                    : 'bg-muted mr-8'
                }`}
              >
                <div className="text-xs font-medium mb-1 opacity-70">
                  {msg.role === 'user' ? 'You' : 'Helper'}
                </div>
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
              </div>
            ))}

            {isLoading && (
              <div className="bg-muted rounded-lg p-3 mr-8">
                <div className="text-xs font-medium mb-1 opacity-70">Helper</div>
                <div className="text-sm text-muted-foreground">Thinking...</div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex gap-2 pt-4 border-t">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask me anything about using this tool..."
            className="min-h-[60px] resize-none"
            disabled={isLoading}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-[60px] w-[60px]"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
