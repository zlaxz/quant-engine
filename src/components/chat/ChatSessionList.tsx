import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/contexts/ChatContext';
import { useSidebar } from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [sessionToRename, setSessionToRename] = useState<ChatSession | null>(null);
  const [newName, setNewName] = useState('');
  const { state } = useSidebar();

  const loadSessions = useCallback(async () => {
    try {
      console.log('[ChatSessionList] Loading sessions...');

      // Simple query without abortSignal (was causing hangs)
      const { data, error } = await supabase
        .from('chat_sessions')
        .select('id, title, created_at, workspace_id')
        .order('created_at', { ascending: false })
        .limit(50);

      console.log('[ChatSessionList] Sessions loaded:', { count: data?.length, error });

      if (error) throw error;

      setSessions(data || []);

      // Auto-select first session if none selected
      if (data && data.length > 0 && !selectedSessionId) {
        setSelectedSession(data[0].id, data[0].workspace_id);
      }
    } catch (error: any) {
      console.error('[ChatSessionList] Load error:', error?.message, error?.code, error?.details);
      // Don't show error toast on abort - just silently fail
      if (error?.name !== 'AbortError') {
        console.warn('Supabase unavailable, starting with empty session list');
      }
    } finally {
      setLoading(false);
    }
  }, [setSelectedSession]); // Fixed: Removed selectedSessionId circular dependency

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const deleteSession = async (sessionId: string) => {
    try {
      const { error } = await supabase
        .from('chat_sessions')
        .delete()
        .eq('id', sessionId);

      if (error) throw error;

      setSessions(sessions.filter(s => s.id !== sessionId));
      
      // If deleted session was selected, clear selection
      if (selectedSessionId === sessionId) {
        setSelectedSession(null, null);
      }
      
      toast.success('Chat session deleted');
    } catch (error) {
      console.error('Error deleting session:', error);
      toast.error('Failed to delete chat session');
    } finally {
      setSessionToDelete(null);
    }
  };

  const renameSession = async () => {
    if (!sessionToRename || !newName.trim()) return;

    try {
      const { error } = await supabase
        .from('chat_sessions')
        .update({ title: newName.trim() })
        .eq('id', sessionToRename.id);

      if (error) throw error;

      setSessions(sessions.map(s => 
        s.id === sessionToRename.id 
          ? { ...s, title: newName.trim() }
          : s
      ));
      
      toast.success('Chat session renamed');
    } catch (error) {
      console.error('Error renaming session:', error);
      toast.error('Failed to rename chat session');
    } finally {
      setSessionToRename(null);
      setNewName('');
    }
  };

  const openRenameDialog = (session: ChatSession) => {
    setSessionToRename(session);
    setNewName(session.title);
  };

  const isCollapsed = state === 'collapsed';

  // Listen for refresh events from ChatSidebar when new sessions are created
  useEffect(() => {
    const handleRefresh = () => {
      loadSessions();
    };
    
    window.addEventListener('refresh-chat-sessions', handleRefresh);
    return () => {
      window.removeEventListener('refresh-chat-sessions', handleRefresh);
    };
  }, [loadSessions]);

  return (
    <TooltipProvider>
      <div className="flex-1 flex flex-col min-h-0">
        <ScrollArea className="flex-1 min-w-0">
          <div className="p-2 space-y-1 min-w-0">
            {loading ? (
              <div className="space-y-2 p-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              !isCollapsed && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  <p>No chat sessions yet</p>
                  <p className="text-xs mt-1">Click + to create one</p>
                </div>
              )
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    'group rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer',
                    'hover:bg-accent/50',
                    selectedSessionId === session.id && 'bg-accent',
                    isCollapsed ? 'p-2 justify-center' : 'px-2 py-1.5'
                  )}
                  onClick={() => setSelectedSession(session.id, session.workspace_id)}
                >
                  {isCollapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <MessageSquare className={cn(
                          "shrink-0 h-4 w-4",
                          selectedSessionId === session.id ? "text-primary" : "text-muted-foreground"
                        )} />
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="font-medium">{session.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(session.created_at).toLocaleDateString()}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <>
                      <MessageSquare className={cn(
                        "h-4 w-4 shrink-0",
                        selectedSessionId === session.id ? "text-primary" : "text-muted-foreground"
                      )} />
                      <div className="flex-1 min-w-0 mr-1">
                        <div className={cn(
                          "text-sm leading-tight break-words",
                          selectedSessionId === session.id ? "font-medium text-foreground" : "text-foreground/80"
                        )}>
                          {session.title}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(session.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={(e) => {
                            e.stopPropagation();
                            openRenameDialog(session);
                          }}
                          title="Rename"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSessionToDelete(session.id);
                          }}
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!sessionToDelete} onOpenChange={() => setSessionToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Chat Session</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this chat session? This will permanently delete all messages in this conversation. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={() => sessionToDelete && deleteSession(sessionToDelete)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Rename Dialog */}
        <Dialog open={!!sessionToRename} onOpenChange={() => setSessionToRename(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Chat Session</DialogTitle>
              <DialogDescription>
                Enter a new name for this chat session.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Session Name</Label>
                <Input
                  id="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && renameSession()}
                  placeholder="Enter session name..."
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSessionToRename(null)}>
                Cancel
              </Button>
              <Button onClick={renameSession} disabled={!newName.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};
