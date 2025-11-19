import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Brain, Plus, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useChatContext } from '@/contexts/ChatContext';
import { format } from 'date-fns';

interface MemoryNote {
  id: string;
  workspace_id: string;
  content: string;
  source: string;
  tags: string[];
  created_at: string;
  run_id: string | null;
  metadata: any;
}

interface MemoryPanelProps {
  onViewRun?: (runId: string) => void;
}

export const MemoryPanel = ({ onViewRun }: MemoryPanelProps) => {
  const { selectedWorkspaceId } = useChatContext();
  const [memoryNotes, setMemoryNotes] = useState<MemoryNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteTags, setNewNoteTags] = useState('');

  useEffect(() => {
    if (selectedWorkspaceId) {
      loadMemoryNotes();
    }
  }, [selectedWorkspaceId]);

  const loadMemoryNotes = async () => {
    if (!selectedWorkspaceId) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('memory_notes')
        .select('*')
        .eq('workspace_id', selectedWorkspaceId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      setMemoryNotes(data || []);
    } catch (error: any) {
      console.error('Error loading memory notes:', error);
      toast.error('Failed to load memory notes');
    } finally {
      setIsLoading(false);
    }
  };

  const saveMemoryNote = async () => {
    if (!selectedWorkspaceId || !newNoteContent.trim()) {
      toast.error('Please enter note content');
      return;
    }

    setIsSaving(true);
    try {
      const tags = newNoteTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const { error } = await supabase
        .from('memory_notes')
        .insert({
          workspace_id: selectedWorkspaceId,
          content: newNoteContent.trim(),
          source: 'manual',
          tags,
        });

      if (error) throw error;

      toast.success('Memory note saved');
      setNewNoteContent('');
      setNewNoteTags('');
      await loadMemoryNotes();
    } catch (error: any) {
      console.error('Error saving memory note:', error);
      toast.error('Failed to save memory note');
    } finally {
      setIsSaving(false);
    }
  };

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'manual':
        return <Badge variant="secondary" className="h-5 text-[10px]">Manual</Badge>;
      case 'run_note':
        return <Badge variant="default" className="h-5 text-[10px]">Run Insight</Badge>;
      case 'system':
        return <Badge variant="outline" className="h-5 text-[10px]">System</Badge>;
      default:
        return <Badge variant="secondary" className="h-5 text-[10px]">{source}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold font-mono mb-2">Memory Notes</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Persistent notes and insights for this workspace
        </p>
      </div>

      {/* Add Note Form */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h4 className="text-xs font-semibold font-mono">Add Memory Note</h4>
        </div>
        <div className="space-y-2">
          <Label htmlFor="note-content" className="text-xs font-mono">Content</Label>
          <Textarea
            id="note-content"
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            placeholder="Enter your insight or note..."
            className="text-xs min-h-[80px]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="note-tags" className="text-xs font-mono">Tags (comma separated)</Label>
          <Input
            id="note-tags"
            value={newNoteTags}
            onChange={(e) => setNewNoteTags(e.target.value)}
            placeholder="momentum, volatility, regime-change..."
            className="text-xs"
          />
        </div>
        <Button
          onClick={saveMemoryNote}
          disabled={isSaving || !newNoteContent.trim() || !selectedWorkspaceId}
          size="sm"
          className="w-full"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Plus className="mr-2 h-3 w-3" />
              Add Note
            </>
          )}
        </Button>
      </Card>

      <Separator />

      {/* Memory Notes List */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold font-mono">Recent Notes</h4>
        
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : memoryNotes.length === 0 ? (
          <div className="p-4 bg-muted rounded-md text-center">
            <p className="text-xs text-muted-foreground">
              No memory stored for this workspace yet
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {memoryNotes.map((note) => (
              <Card key={note.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-1">
                    <p className="text-xs leading-relaxed">{note.content}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {getSourceBadge(note.source)}
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
                      </span>
                    </div>
                  </div>
                  {note.run_id && onViewRun && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px]"
                      onClick={() => onViewRun(note.run_id!)}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      View Run
                    </Button>
                  )}
                </div>
                {note.tags && note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {note.tags.map((tag, idx) => (
                      <Badge key={idx} variant="outline" className="h-5 text-[9px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {!selectedWorkspaceId && (
        <div className="p-4 bg-muted/50 rounded-md text-center">
          <p className="text-xs text-muted-foreground">
            Select a workspace to view memory notes
          </p>
        </div>
      )}
    </div>
  );
};
