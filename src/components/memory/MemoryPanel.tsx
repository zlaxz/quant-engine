import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Brain, Plus, ExternalLink, Loader2, Search, X, Edit2, Archive, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import { useChatContext } from '@/contexts/ChatContext';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface MemoryNote {
  id: string;
  workspace_id: string;
  content: string;
  source: string;
  tags: string[];
  created_at: string;
  updated_at?: string;
  run_id: string | null;
  metadata: any;
  memory_type: string;
  importance: string;
  archived: boolean;
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
  const [newNoteType, setNewNoteType] = useState('insight');
  const [newNoteImportance, setNewNoteImportance] = useState('normal');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MemoryNote[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterImportance, setFilterImportance] = useState('all');
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const itemsPerPage = 50;
  
  // Edit state
  const [editingNote, setEditingNote] = useState<MemoryNote | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editType, setEditType] = useState('insight');
  const [editImportance, setEditImportance] = useState('normal');
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (selectedWorkspaceId) {
      setCurrentPage(1); // Reset to first page on workspace/view change
      loadMemoryNotes();
      setFilterType('all');
      setFilterImportance('all');
      setHasSearched(false);
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [selectedWorkspaceId, viewMode]);
  
  useEffect(() => {
    if (selectedWorkspaceId && !hasSearched) {
      loadMemoryNotes();
    }
  }, [currentPage]);

  const loadMemoryNotes = async () => {
    if (!selectedWorkspaceId) return;

    setIsLoading(true);
    try {
      const offset = (currentPage - 1) * itemsPerPage;
      
      // Get total count
      const { count, error: countError } = await supabase
        .from('memory_notes')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', selectedWorkspaceId)
        .eq('archived', viewMode === 'archived');
      
      if (countError) throw countError;
      setTotalCount(count || 0);
      
      // Get paginated data
      const { data, error } = await supabase
        .from('memory_notes')
        .select('*')
        .eq('workspace_id', selectedWorkspaceId)
        .eq('archived', viewMode === 'archived')
        .order('created_at', { ascending: false })
        .range(offset, offset + itemsPerPage - 1);

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
      // Deduplicate tags
      const tags = Array.from(new Set(
        newNoteTags
          .split(',')
          .map(t => t.trim())
          .filter(t => t.length > 0)
      ));

      const { error, data } = await supabase.functions.invoke('memory-create', {
        body: {
          workspaceId: selectedWorkspaceId,
          content: newNoteContent.trim(),
          source: 'manual',
          tags,
          memoryType: newNoteType,
          importance: newNoteImportance,
        },
      });

      if (error) {
        // Handle specific error types
        if (error.message?.includes('embedding')) {
          toast.error('Failed to create embedding. Please try again.');
        } else {
          toast.error('Failed to save memory note');
        }
        throw error;
      }

      toast.success('Memory note saved');
      setNewNoteContent('');
      setNewNoteTags('');
      setNewNoteType('insight');
      setNewNoteImportance('normal');
      await loadMemoryNotes();
    } catch (error: any) {
      console.error('Error saving memory note:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (note: MemoryNote) => {
    setEditingNote(note);
    setEditContent(note.content);
    setEditTags((note.tags || []).join(', '));
    setEditType(note.memory_type || 'insight');
    setEditImportance(note.importance || 'normal');
  };

  const cancelEdit = () => {
    setEditingNote(null);
    setEditContent('');
    setEditTags('');
    setEditType('insight');
    setEditImportance('normal');
  };

  const saveEdit = async () => {
    if (!editingNote || !editContent.trim()) {
      toast.error('Please enter note content');
      return;
    }

    setIsUpdating(true);
    try {
      // Deduplicate tags
      const tags = Array.from(new Set(
        editTags
          .split(',')
          .map(t => t.trim())
          .filter(t => t.length > 0)
      ));

      const { error } = await supabase.functions.invoke('memory-update', {
        body: {
          noteId: editingNote.id,
          content: editContent.trim(),
          memoryType: editType,
          importance: editImportance,
          tags,
        },
      });

      if (error) throw error;

      toast.success('Memory note updated');
      cancelEdit();
      
      // Refresh both main notes and search results if applicable
      await loadMemoryNotes();
      if (hasSearched && searchQuery.trim()) {
        await performSemanticSearch();
      }
    } catch (error: any) {
      console.error('Error updating memory note:', error);
      toast.error('Failed to update memory note');
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleArchive = async (note: MemoryNote) => {
    try {
      const { error } = await supabase.functions.invoke('memory-update', {
        body: {
          noteId: note.id,
          archived: !note.archived,
        },
      });

      if (error) throw error;

      toast.success(note.archived ? 'Note restored' : 'Note archived');
      await loadMemoryNotes();
      
      // Refresh search results if applicable
      if (hasSearched && searchQuery.trim()) {
        await performSemanticSearch();
      }
    } catch (error: any) {
      console.error('Error toggling archive:', error);
      toast.error('Failed to update note');
    }
  };

  const performSemanticSearch = async () => {
    if (!selectedWorkspaceId || !searchQuery.trim()) {
      toast.error('Please enter a search query');
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    try {
      const { data, error } = await supabase.functions.invoke('memory-search', {
        body: {
          workspaceId: selectedWorkspaceId,
          query: searchQuery.trim(),
          limit: 10,
        },
      });

      if (error) {
        // Handle specific error types
        const errorData = error as { message?: string; error?: string };
        if (errorData.error === 'EMBEDDING_FAILED') {
          toast.error('Failed to process search query. Please try again.');
        } else if (errorData.error === 'DATABASE_ERROR') {
          toast.error('Database search failed. Please try again.');
        } else {
          toast.error('Failed to search memory');
        }
        throw error;
      }

      setSearchResults(data?.results || []);
      
      if (data?.results?.length === 0) {
        toast.info('No matching memory found');
      } else {
        toast.success(`Found ${data.results.length} relevant notes`);
      }
    } catch (error: any) {
      console.error('Error searching memory:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setHasSearched(false);
  };

  const applyFilters = (notes: MemoryNote[]) => {
    return notes.filter(note => {
      const typeMatch = filterType === 'all' || note.memory_type === filterType;
      
      let importanceMatch = true;
      if (filterImportance === 'high-critical') {
        importanceMatch = note.importance === 'high' || note.importance === 'critical';
      } else if (filterImportance === 'critical') {
        importanceMatch = note.importance === 'critical';
      } else if (filterImportance !== 'all') {
        importanceMatch = note.importance === filterImportance;
      }
      
      return typeMatch && importanceMatch;
    });
  };

  const getTypeBadge = (type: string) => {
    const typeMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      insight: { label: 'Insight', variant: 'secondary' },
      rule: { label: 'Rule', variant: 'default' },
      warning: { label: 'Warning', variant: 'destructive' },
      todo: { label: 'Todo', variant: 'outline' },
      bug: { label: 'Bug', variant: 'destructive' },
      profile_change: { label: 'Profile', variant: 'outline' },
    };
    
    const config = typeMap[type] || { label: type, variant: 'secondary' };
    return <Badge variant={config.variant} className="h-5 text-[10px]">{config.label}</Badge>;
  };

  const getImportanceBadge = (importance: string) => {
    const classMap: Record<string, string> = {
      low: 'bg-muted text-muted-foreground border-muted',
      normal: 'bg-secondary text-secondary-foreground',
      high: 'bg-primary/20 text-primary border-primary',
      critical: 'bg-destructive text-destructive-foreground border-destructive',
    };
    
    const className = classMap[importance] || classMap.normal;
    const label = importance.charAt(0).toUpperCase() + importance.slice(1);
    
    return (
      <Badge variant="outline" className={`h-5 text-[10px] ${className}`}>
        {label}
      </Badge>
    );
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

  const renderMemoryList = (notes: MemoryNote[], title: string) => {
    const filteredNotes = applyFilters(notes);
    
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold font-mono">{title}</h4>
          {hasSearched && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSearch}
              className="h-6 text-[10px]"
            >
              <X className="h-3 w-3 mr-1" />
              Clear Search
            </Button>
          )}
        </div>
        
        {filteredNotes.length === 0 ? (
          <div className="p-4 bg-muted rounded-md text-center">
            <p className="text-xs text-muted-foreground">
              {notes.length === 0 
                ? (hasSearched ? 'No matching memory found' : `No ${viewMode} memory notes`)
                : 'No notes match the selected filters'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredNotes.map((note) => (
              <Card key={note.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-1">
                    <p className="text-xs leading-relaxed">{note.content}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {getTypeBadge(note.memory_type || 'insight')}
                      {getImportanceBadge(note.importance || 'normal')}
                      {getSourceBadge(note.source)}
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
                      </span>
                      {note.updated_at && note.updated_at !== note.created_at && (
                        <span className="text-[10px] text-muted-foreground italic">
                          (edited)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => startEdit(note)}
                      title="Edit note"
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => toggleArchive(note)}
                      title={note.archived ? 'Restore note' : 'Archive note'}
                    >
                      {note.archived ? (
                        <ArchiveRestore className="h-3 w-3" />
                      ) : (
                        <Archive className="h-3 w-3" />
                      )}
                    </Button>
                    {note.run_id && onViewRun && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => onViewRun(note.run_id!)}
                        title="View run"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
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
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4" />
        <h3 className="text-sm font-semibold">Workspace Memory</h3>
      </div>

      {selectedWorkspaceId ? (
        <>
          {/* Add Memory Note */}
          <Card className="p-4 space-y-3">
            <h4 className="text-xs font-semibold font-mono">Add Memory Note</h4>
            <div className="space-y-2">
              <div>
                <Label htmlFor="note-content" className="text-xs">Content</Label>
                <Textarea
                  id="note-content"
                  placeholder="Describe the insight, rule, or observation..."
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  className="text-xs min-h-[60px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="note-type" className="text-xs">Type</Label>
                  <Select value={newNoteType} onValueChange={setNewNoteType}>
                    <SelectTrigger id="note-type" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="insight">Insight</SelectItem>
                      <SelectItem value="rule">Rule</SelectItem>
                      <SelectItem value="warning">Warning</SelectItem>
                      <SelectItem value="todo">Todo</SelectItem>
                      <SelectItem value="bug">Bug</SelectItem>
                      <SelectItem value="profile_change">Profile Change</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="note-importance" className="text-xs">Importance</Label>
                  <Select value={newNoteImportance} onValueChange={setNewNoteImportance}>
                    <SelectTrigger id="note-importance" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="note-tags" className="text-xs">Tags (comma-separated)</Label>
                <Input
                  id="note-tags"
                  placeholder="momentum, trend, volatility"
                  value={newNoteTags}
                  onChange={(e) => setNewNoteTags(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <Button
                onClick={saveMemoryNote}
                disabled={isSaving || !newNoteContent.trim()}
                className="w-full h-8 text-xs"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3 mr-2" />
                    Save Memory
                  </>
                )}
              </Button>
            </div>
          </Card>

          <Separator />

          {/* Semantic Search */}
          <Card className="p-4 space-y-3">
            <h4 className="text-xs font-semibold font-mono">Semantic Search</h4>
            <div className="flex gap-2">
              <Input
                placeholder="Search memory semantically..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    performSemanticSearch();
                  }
                }}
                className="text-xs h-8"
              />
              <Button
                onClick={performSemanticSearch}
                disabled={isSearching || !searchQuery.trim()}
                size="sm"
                className="h-8"
              >
                {isSearching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Search className="h-3 w-3" />
                )}
              </Button>
            </div>
          </Card>

          <Separator />

          {/* Filters */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Filter by Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="insight">Insight</SelectItem>
                  <SelectItem value="rule">Rule</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="todo">Todo</SelectItem>
                  <SelectItem value="bug">Bug</SelectItem>
                  <SelectItem value="profile_change">Profile Change</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Filter by Importance</Label>
              <Select value={filterImportance} onValueChange={setFilterImportance}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="high-critical">High + Critical</SelectItem>
                  <SelectItem value="critical">Critical Only</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Memory Notes with Tabs */}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'active' | 'archived')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="active" className="text-xs">Active Notes</TabsTrigger>
              <TabsTrigger value="archived" className="text-xs">Archived</TabsTrigger>
            </TabsList>
            
            <TabsContent value="active" className="mt-4">
              {isLoading ? (
                <div className="p-4 text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </div>
              ) : hasSearched ? (
                renderMemoryList(searchResults, `Search Results (${searchResults.length})`)
              ) : (
                renderMemoryList(memoryNotes, `Recent Active Notes (${memoryNotes.length})`)
              )}
            </TabsContent>
            
            <TabsContent value="archived" className="mt-4">
              {isLoading ? (
                <div className="p-4 text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </div>
              ) : (
                renderMemoryList(memoryNotes, `Archived Notes (${memoryNotes.length})`)
              )}
            </TabsContent>
          </Tabs>

          {/* Pagination Controls */}
          {!hasSearched && totalCount > itemsPerPage && (
            <div className="flex items-center justify-between mt-4 px-2">
              <div className="text-xs text-muted-foreground">
                Showing {((currentPage - 1) * itemsPerPage) + 1}-{Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-7 text-xs"
                >
                  Previous
                </Button>
                <div className="flex items-center px-3 text-xs">
                  Page {currentPage} of {Math.ceil(totalCount / itemsPerPage)}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPage(p => Math.min(Math.ceil(totalCount / itemsPerPage), p + 1))}
                  disabled={currentPage >= Math.ceil(totalCount / itemsPerPage)}
                  className="h-7 text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Edit Dialog */}
          <Dialog open={!!editingNote} onOpenChange={(open) => !open && cancelEdit()}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Memory Note</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="edit-content" className="text-xs">Content</Label>
                  <Textarea
                    id="edit-content"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="text-xs min-h-[80px]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="edit-type" className="text-xs">Type</Label>
                    <Select value={editType} onValueChange={setEditType}>
                      <SelectTrigger id="edit-type" className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="insight">Insight</SelectItem>
                        <SelectItem value="rule">Rule</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="todo">Todo</SelectItem>
                        <SelectItem value="bug">Bug</SelectItem>
                        <SelectItem value="profile_change">Profile Change</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="edit-importance" className="text-xs">Importance</Label>
                    <Select value={editImportance} onValueChange={setEditImportance}>
                      <SelectTrigger id="edit-importance" className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="edit-tags" className="text-xs">Tags (comma-separated)</Label>
                  <Input
                    id="edit-tags"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={cancelEdit} className="text-xs">
                  Cancel
                </Button>
                <Button onClick={saveEdit} disabled={isUpdating || !editContent.trim()} className="text-xs">
                  {isUpdating ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <div className="p-4 bg-muted rounded-md text-center">
          <p className="text-xs text-muted-foreground">
            Select a workspace to view memory notes
          </p>
        </div>
      )}
    </div>
  );
};
