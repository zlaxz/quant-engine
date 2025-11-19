import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/contexts/ChatContext';
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
              <div
                key={session.id}
                className={cn(
                  'group rounded-md transition-colors mb-1 p-2 flex items-center gap-2 w-full max-w-full',
                  'hover:bg-muted/50',
                  selectedSessionId === session.id && 'bg-muted'
                )}
              >
                <button
                  onClick={() => setSelectedSession(session.id, session.workspace_id)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0 overflow-hidden"
                >
                  <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="font-medium text-sm truncate">
                      {session.title}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {new Date(session.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </button>
                
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      openRenameDialog(session);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionToDelete(session.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
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
  );
};
