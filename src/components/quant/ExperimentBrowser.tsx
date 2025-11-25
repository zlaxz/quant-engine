import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, FileText, Calendar, Zap, Activity, AlertCircle, Save, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { BacktestRun } from '@/types/backtest';

interface ExperimentBrowserProps {
  sessionId: string | null;
  onSelectRun: (run: BacktestRun) => void;
  selectedRunId?: string;
  selectedForComparison?: string[];
  onToggleComparison?: (runId: string) => void;
}

export const ExperimentBrowser = ({ 
  sessionId, 
  onSelectRun, 
  selectedRunId,
  selectedForComparison = [],
  onToggleComparison
}: ExperimentBrowserProps) => {
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    if (sessionId) {
      loadRuns();
    } else {
      setRuns([]);
    }
  }, [sessionId]);

  const loadRuns = async () => {
    if (!sessionId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('backtest_runs')
        .select('*')
        .eq('session_id', sessionId)
        .order('started_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      setRuns(data || []);
    } catch (error: any) {
      console.error('Error loading runs:', error);
      toast.error('Failed to load experiment history');
    } finally {
      setLoading(false);
    }
  };

  const startEditingNote = (run: BacktestRun) => {
    setEditingNoteId(run.id);
    setNoteText(run.notes || '');
  };

  const saveNote = async (runId: string) => {
    setSavingNote(true);
    try {
      const { error } = await supabase
        .from('backtest_runs')
        .update({ notes: noteText })
        .eq('id', runId);

      if (error) throw error;

      // Update local state
      setRuns(runs.map(run => 
        run.id === runId ? { ...run, notes: noteText } : run
      ));

      setEditingNoteId(null);
      toast.success('Note saved');
    } catch (error: any) {
      console.error('Error saving note:', error);
      toast.error('Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getEngineIcon = (engineSource?: string) => {
    switch (engineSource) {
      case 'external':
      case 'rotation-engine-bridge':
        return <Zap className="h-3 w-3" />;
      case 'stub_fallback':
        return <AlertCircle className="h-3 w-3" />;
      default:
        return <Activity className="h-3 w-3" />;
    }
  };

  const getEngineLabel = (engineSource?: string) => {
    switch (engineSource) {
      case 'external':
        return 'Live';
      case 'rotation-engine-bridge':
        return 'Bridge';
      case 'stub_fallback':
        return 'Fallback';
      default:
        return 'Stub';
    }
  };

  if (!sessionId) {
    return (
      <Card className="p-4 bg-muted/50">
        <p className="text-xs text-center text-muted-foreground">
          Select a chat session to view experiments
        </p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading experiments...
        </div>
      </Card>
    );
  }

  if (runs.length === 0) {
    return (
      <Card className="p-4 bg-muted/50">
        <div className="text-center space-y-2">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            No experiments yet
          </p>
          <p className="text-xs text-muted-foreground">
            Run a backtest to start tracking
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold font-mono">Experiment History</h4>
        <Badge variant="outline" className="text-[10px]">
          {runs.length} runs
        </Badge>
      </div>

      <ScrollArea className="h-[400px]">
        <div className="space-y-2 pr-3">
          {runs.map((run) => (
            <Card
              key={run.id}
              className={cn(
                'p-3 transition-all hover:shadow-md',
                selectedRunId === run.id && 'ring-2 ring-primary'
              )}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {/* Comparison Checkbox */}
                  {onToggleComparison && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleComparison(run.id);
                      }}
                      className={cn(
                        'flex-shrink-0 w-4 h-4 rounded border-2 transition-colors flex items-center justify-center',
                        selectedForComparison.includes(run.id)
                          ? 'bg-primary border-primary'
                          : 'border-muted-foreground hover:border-primary'
                      )}
                    >
                      {selectedForComparison.includes(run.id) && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </button>
                  )}
                  
                  <div 
                    className="flex-1 min-w-0 cursor-pointer" 
                    onClick={() => onSelectRun(run)}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <h5 className="text-xs font-semibold truncate">
                        {run.strategy_key.replace(/_/g, ' ').replace(/v\d+$/, '')}
                      </h5>
                      <Badge variant="secondary" className="text-[9px] h-4 px-1">
                        {getEngineIcon(run.engine_source || undefined)}
                        <span className="ml-0.5">{getEngineLabel(run.engine_source || undefined)}</span>
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Calendar className="h-2.5 w-2.5" />
                      {run.started_at && formatDate(run.started_at)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Metrics Preview */}
              {run.metrics && (
                <div className="grid grid-cols-3 gap-2 mb-2 text-[10px]">
                  <div>
                    <div className="text-muted-foreground">CAGR</div>
                    <div className="font-semibold">
                      {(run.metrics.cagr * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Sharpe</div>
                    <div className="font-semibold">
                      {run.metrics.sharpe.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">MaxDD</div>
                    <div className="font-semibold text-destructive">
                      {(run.metrics.max_drawdown * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
              )}

              {/* Notes Section */}
              {editingNoteId === run.id ? (
                <div className="space-y-2 mt-2 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
                  <Textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add research notes..."
                    className="text-xs min-h-[60px] resize-none"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => saveNote(run.id)}
                      disabled={savingNote}
                      className="h-6 text-[10px] flex-1"
                    >
                      {savingNote ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Save className="h-3 w-3 mr-1" />
                          Save
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingNoteId(null)}
                      className="h-6 text-[10px]"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {run.notes ? (
                    <div 
                      className="mt-2 pt-2 border-t text-[10px] text-muted-foreground cursor-text hover:text-foreground transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditingNote(run);
                      }}
                    >
                      <div className="flex items-start gap-1">
                        <FileText className="h-3 w-3 mt-0.5 shrink-0" />
                        <p className="line-clamp-2">{run.notes}</p>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-full mt-2 text-[10px] text-muted-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditingNote(run);
                      }}
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      Add notes
                    </Button>
                  )}
                </>
              )}
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
