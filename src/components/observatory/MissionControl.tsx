/**
 * MissionControl - Always-visible focus anchor for ADHD-friendly workflow
 *
 * Shows: Current focus, quick idea capture, decisions made, next steps
 * Persists to Supabase so nothing gets lost between sessions
 */

import { useState, useEffect, useCallback } from 'react';
import { Target, Lightbulb, CheckCircle2, ChevronRight, Plus, X, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';

// Types
interface MissionState {
  current_focus: string;
  phase: string;
  ideas: Idea[];
  decisions: Decision[];
  next_steps: string[];
}

interface Idea {
  id: string;
  text: string;
  created_at: string;
  starred: boolean;
}

interface Decision {
  id: string;
  from_state: string;
  to_state: string;
  reason: string;
  date: string;
}

// Default state
const DEFAULT_STATE: MissionState = {
  current_focus: 'Factor Strategy Engine - Interleaved Sampling',
  phase: 'Design Complete → Implementation',
  ideas: [],
  decisions: [
    {
      id: '1',
      from_state: 'Regime-based trading',
      to_state: 'Factor-based approach',
      reason: 'Each year too unique for discrete buckets',
      date: '2025-12-06'
    }
  ],
  next_steps: [
    'Build interleaved sampling logic (odd/even months)',
    'Run Scout Swarm on discovery set only',
    'Implement 3-set validation: Discovery/Validation/Walk-Forward'
  ]
};

export function MissionControl() {
  const [state, setState] = useState<MissionState>(DEFAULT_STATE);
  const [newIdea, setNewIdea] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load state from Supabase
  useEffect(() => {
    async function loadState() {
      if (!isSupabaseConfigured()) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('mission_control')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (data && !error) {
          setState({
            current_focus: data.current_focus || DEFAULT_STATE.current_focus,
            phase: data.phase || DEFAULT_STATE.phase,
            ideas: data.ideas || [],
            decisions: data.decisions || DEFAULT_STATE.decisions,
            next_steps: data.next_steps || DEFAULT_STATE.next_steps,
          });
        }
      } catch (e) {
        // Table might not exist yet, use defaults
        console.log('Mission control table not found, using defaults');
      }
      setLoading(false);
    }

    loadState();
  }, []);

  // Save state to Supabase
  const saveState = useCallback(async (newState: MissionState) => {
    if (!isSupabaseConfigured()) return;

    try {
      await supabase
        .from('mission_control')
        .upsert({
          id: 'current',
          current_focus: newState.current_focus,
          phase: newState.phase,
          ideas: newState.ideas,
          decisions: newState.decisions,
          next_steps: newState.next_steps,
          updated_at: new Date().toISOString()
        });
    } catch (e) {
      console.error('Failed to save mission state:', e);
    }
  }, []);

  // Add idea
  const addIdea = useCallback(() => {
    if (!newIdea.trim()) return;

    const idea: Idea = {
      id: Date.now().toString(),
      text: newIdea.trim(),
      created_at: new Date().toISOString(),
      starred: false
    };

    const newState = {
      ...state,
      ideas: [idea, ...state.ideas]
    };

    setState(newState);
    saveState(newState);
    setNewIdea('');
  }, [newIdea, state, saveState]);

  // Toggle star on idea
  const toggleStar = useCallback((ideaId: string) => {
    const newState = {
      ...state,
      ideas: state.ideas.map(i =>
        i.id === ideaId ? { ...i, starred: !i.starred } : i
      )
    };
    setState(newState);
    saveState(newState);
  }, [state, saveState]);

  // Remove idea
  const removeIdea = useCallback((ideaId: string) => {
    const newState = {
      ...state,
      ideas: state.ideas.filter(i => i.id !== ideaId)
    };
    setState(newState);
    saveState(newState);
  }, [state, saveState]);

  // Complete next step
  const completeStep = useCallback((index: number) => {
    const newState = {
      ...state,
      next_steps: state.next_steps.filter((_, i) => i !== index)
    };
    setState(newState);
    saveState(newState);
  }, [state, saveState]);

  if (loading) {
    return (
      <div className="bg-card border rounded-lg p-4 animate-pulse">
        <div className="h-6 bg-muted rounded w-1/3" />
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      {/* Always visible header */}
      <div
        className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Target className="h-5 w-5 text-primary" />
            <div>
              <div className="font-semibold text-sm">
                {state.current_focus}
              </div>
              <div className="text-xs text-muted-foreground">
                {state.phase} • {state.decisions.length} decisions • {state.ideas.length} ideas
              </div>
            </div>
          </div>
          <ChevronRight className={cn(
            "h-5 w-5 text-muted-foreground transition-transform",
            isExpanded && "rotate-90"
          )} />
        </div>
      </div>

      {/* Quick capture - always visible when expanded */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Idea capture */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Lightbulb className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={newIdea}
                onChange={(e) => setNewIdea(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addIdea()}
                placeholder="Capture idea... (Enter to save)"
                className="pl-10 h-9 text-sm"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={addIdea}
              disabled={!newIdea.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Ideas list */}
          {state.ideas.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Ideas ({state.ideas.length})
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {state.ideas.map(idea => (
                  <div
                    key={idea.id}
                    className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50 group"
                  >
                    <button
                      onClick={() => toggleStar(idea.id)}
                      className="text-muted-foreground hover:text-yellow-500"
                    >
                      <Star className={cn(
                        "h-3 w-3",
                        idea.starred && "fill-yellow-500 text-yellow-500"
                      )} />
                    </button>
                    <span className="flex-1">{idea.text}</span>
                    <button
                      onClick={() => removeIdea(idea.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Decisions */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Decisions Made
            </div>
            <div className="space-y-1">
              {state.decisions.map(decision => (
                <div
                  key={decision.id}
                  className="text-sm p-2 rounded bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground line-through">{decision.from_state}</span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{decision.to_state}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">
                      {decision.date}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {decision.reason}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Next Steps */}
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Next Steps
            </div>
            <div className="space-y-1">
              {state.next_steps.map((step, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50 group"
                >
                  <button
                    onClick={() => completeStep(index)}
                    className="text-muted-foreground hover:text-green-500"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                  <span className="flex-1">{step}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {index + 1}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
