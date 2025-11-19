import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/contexts/ChatContext';

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  workspace_id: string;
}

export const ChatSessionList = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedSessionId, setSelectedSession } = useChatContext();

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_sessions')
        .select('id, title, created_at, workspace_id')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      setSessions(data || []);
      
      // Auto-select first session if none selected
      if (data && data.length > 0 && !selectedSessionId) {
        setSelectedSession(data[0].id, data[0].workspace_id);
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
      toast.error('Failed to load chat sessions');
    } finally {
      setLoading(false);
    }
  };

  const createNewSession = async () => {
    try {
      // Get first workspace
      const { data: workspaces } = await supabase
        .from('workspaces')
        .select('id')
        .limit(1)
        .single();

      if (!workspaces) {
        toast.error('No workspace found. Please create a workspace first.');
        return;
      }

      const { data, error } = await supabase
        .from('chat_sessions')
        .insert({
          title: `Chat ${new Date().toLocaleString()}`,
          workspace_id: workspaces.id,
        })
        .select()
        .single();

      if (error) throw error;

      setSessions([data, ...sessions]);
      setSelectedSession(data.id, data.workspace_id);
      
      toast.success('New chat session created');
    } catch (error) {
      console.error('Error creating session:', error);
      toast.error('Failed to create chat session');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-3 border-b border-panel-border flex items-center justify-between">
        <span className="text-xs font-mono uppercase text-muted-foreground tracking-wider">
          Chat Sessions
        </span>
        <Button 
          size="icon" 
          variant="ghost" 
          className="h-6 w-6"
          onClick={createNewSession}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {loading ? (
            <div className="space-y-2 p-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <p>No chat sessions yet</p>
              <p className="text-xs mt-1">Click + to create one</p>
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setSelectedSession(session.id, session.workspace_id)}
                className={cn(
                  'w-full text-left p-3 rounded-md transition-colors',
                  'hover:bg-muted/50',
                  selectedSessionId === session.id && 'bg-muted'
                )}
              >
                <div className="flex items-start gap-2">
                  <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {session.title}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {new Date(session.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
