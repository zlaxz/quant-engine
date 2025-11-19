import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';

export const ChatArea = () => {
  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border p-4">
        <h2 className="text-lg font-semibold font-mono">Chat Session</h2>
        <p className="text-sm text-muted-foreground">No active session</p>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4">
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center space-y-2">
            <div className="text-4xl">💬</div>
            <p className="text-sm font-mono">No messages yet</p>
            <p className="text-xs">Start a conversation to begin</p>
          </div>
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <Textarea
            placeholder="Type your message..."
            className="resize-none font-mono text-sm"
            rows={3}
            disabled
          />
          <Button size="icon" className="shrink-0" disabled>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground font-mono">
          Phase 1: Static UI scaffold - messaging coming in Phase 2
        </div>
      </div>
    </div>
  );
};
