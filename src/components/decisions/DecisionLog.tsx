/**
 * DecisionLog - Audit trail of all trading decisions
 *
 * PHASE 1 SAFETY: Every manual action is logged with reason
 *
 * Features:
 * - Timeline view (default)
 * - Filter by type, date range, actor
 * - Search by description/reason
 * - "Why did I do that?" quick lookup
 * - Link decisions to outcomes
 * - Retrospective rating
 *
 * ADHD Design:
 * - Answers "Why did I do that?" instantly
 * - Shows context at time of decision
 * - Links to outcomes for learning
 */

import { useState, useEffect, useCallback } from 'react';
import {
  StopCircle,
  TrendingUp,
  PauseCircle,
  PlayCircle,
  Settings,
  AlertTriangle,
  User,
  Bot,
  Search,
  Calendar,
  Filter,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// =========================================================================
// Types
// =========================================================================

export type DecisionType =
  | 'kill_switch'
  | 'strategy_promotion'
  | 'strategy_retirement'
  | 'strategy_pause'
  | 'strategy_resume'
  | 'parameter_change'
  | 'risk_adjustment'
  | 'manual_trade'
  | 'resume_trading'
  | 'override'
  | 'system_action';

export interface Decision {
  id: string;
  timestamp: string;
  decision_type: DecisionType;
  description: string;
  reason?: string;
  context: {
    pnlAtTime?: number;
    positionsAtTime?: any[];
    riskStateAtTime?: any;
    regimeAtTime?: string;
    triggeredBy?: string;
    [key: string]: any;
  };
  outcome?: string;
  outcome_at?: string;
  outcome_pnl?: number;
  was_good_decision?: boolean;
  actor: 'human' | 'system';
  created_at: string;
}

interface DecisionLogProps {
  /** Limit number of decisions to show */
  limit?: number;
  /** Filter by type */
  typeFilter?: DecisionType | 'all';
  /** Show search */
  showSearch?: boolean;
  /** Show filters */
  showFilters?: boolean;
  /** Custom class name */
  className?: string;
}

// =========================================================================
// Configuration
// =========================================================================

const DECISION_CONFIG: Record<DecisionType, { label: string; icon: typeof StopCircle; color: string }> = {
  kill_switch: { label: 'Kill Switch', icon: StopCircle, color: 'text-red-500' },
  strategy_promotion: { label: 'Strategy Promoted', icon: TrendingUp, color: 'text-green-500' },
  strategy_retirement: { label: 'Strategy Retired', icon: AlertTriangle, color: 'text-yellow-500' },
  strategy_pause: { label: 'Strategy Paused', icon: PauseCircle, color: 'text-yellow-500' },
  strategy_resume: { label: 'Strategy Resumed', icon: PlayCircle, color: 'text-green-500' },
  parameter_change: { label: 'Parameter Changed', icon: Settings, color: 'text-blue-500' },
  risk_adjustment: { label: 'Risk Adjusted', icon: AlertTriangle, color: 'text-yellow-500' },
  manual_trade: { label: 'Manual Trade', icon: User, color: 'text-purple-500' },
  resume_trading: { label: 'Trading Resumed', icon: PlayCircle, color: 'text-green-500' },
  override: { label: 'Override', icon: AlertTriangle, color: 'text-orange-500' },
  system_action: { label: 'System Action', icon: Bot, color: 'text-gray-500' },
};

// =========================================================================
// Helper Components
// =========================================================================

function DecisionItem({
  decision,
  onRate,
}: {
  decision: Decision;
  onRate?: (id: string, wasGood: boolean) => void;
}) {
  const config = DECISION_CONFIG[decision.decision_type];
  const Icon = config.icon;

  const timeAgo = formatTimeAgo(new Date(decision.timestamp));
  const hasOutcome = decision.outcome !== undefined;

  return (
    <div className="border rounded-lg p-3 bg-card/50 hover:bg-card/80 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={cn('p-2 rounded-full bg-muted/50', config.color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{decision.description}</span>
            <Badge variant="outline" className="text-[10px] px-1.5">
              {config.label}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] px-1.5',
                decision.actor === 'human' ? 'border-purple-500/30 text-purple-500' : 'border-gray-500/30 text-gray-500'
              )}
            >
              {decision.actor === 'human' ? <User className="h-2.5 w-2.5 mr-0.5" /> : <Bot className="h-2.5 w-2.5 mr-0.5" />}
              {decision.actor}
            </Badge>
          </div>

          {/* Reason */}
          {decision.reason && (
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-medium">Why:</span> {decision.reason}
            </p>
          )}

          {/* Context */}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo}
            </span>
            {decision.context.pnlAtTime !== undefined && (
              <span className={cn(
                'font-mono',
                decision.context.pnlAtTime >= 0 ? 'text-green-500' : 'text-red-500'
              )}>
                P&L: ${decision.context.pnlAtTime.toLocaleString()}
              </span>
            )}
            {decision.context.regimeAtTime && (
              <span>Regime: {decision.context.regimeAtTime}</span>
            )}
          </div>

          {/* Outcome */}
          {hasOutcome && (
            <div className="mt-2 p-2 bg-muted/30 rounded text-sm">
              <div className="flex items-center justify-between">
                <span>
                  <span className="font-medium">Outcome:</span> {decision.outcome}
                </span>
                {decision.outcome_pnl !== undefined && (
                  <span className={cn(
                    'font-mono font-medium',
                    decision.outcome_pnl >= 0 ? 'text-green-500' : 'text-red-500'
                  )}>
                    {decision.outcome_pnl >= 0 ? '+' : ''}${decision.outcome_pnl.toLocaleString()}
                  </span>
                )}
              </div>

              {/* Retrospective Rating */}
              {decision.was_good_decision === null && onRate && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground">Was this a good decision?</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                    onClick={() => onRate(decision.id, true)}
                  >
                    <ThumbsUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    onClick={() => onRate(decision.id, false)}
                  >
                    <ThumbsDown className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {decision.was_good_decision !== null && (
                <div className="flex items-center gap-1 mt-2 text-xs">
                  {decision.was_good_decision ? (
                    <ThumbsUp className="h-3 w-3 text-green-500" />
                  ) : (
                    <ThumbsDown className="h-3 w-3 text-red-500" />
                  )}
                  <span className="text-muted-foreground">
                    Rated as {decision.was_good_decision ? 'good' : 'bad'} decision
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function DecisionLog({
  limit = 50,
  typeFilter = 'all',
  showSearch = true,
  showFilters = true,
  className,
}: DecisionLogProps) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actorFilter, setActorFilter] = useState<'all' | 'human' | 'system'>('all');
  const [selectedType, setSelectedType] = useState<DecisionType | 'all'>(typeFilter);

  // Fetch decisions
  const fetchDecisions = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('decisions')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (selectedType !== 'all') {
        query = query.eq('decision_type', selectedType);
      }
      if (actorFilter !== 'all') {
        query = query.eq('actor', actorFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setDecisions(data || []);
    } catch (err) {
      console.error('[DecisionLog] Failed to fetch:', err);
      setDecisions([]);
    } finally {
      setIsLoading(false);
    }
  }, [limit, selectedType, actorFilter]);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  // Filter by search
  const filteredDecisions = decisions.filter(d => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      d.description.toLowerCase().includes(query) ||
      d.reason?.toLowerCase().includes(query) ||
      d.outcome?.toLowerCase().includes(query)
    );
  });

  // Rate decision
  const handleRate = useCallback(async (id: string, wasGood: boolean) => {
    try {
      await supabase
        .from('decisions')
        .update({ was_good_decision: wasGood })
        .eq('id', id);

      setDecisions(prev =>
        prev.map(d => (d.id === id ? { ...d, was_good_decision: wasGood } : d))
      );
    } catch (err) {
      console.error('[DecisionLog] Failed to rate:', err);
    }
  }, []);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Filters */}
      {(showSearch || showFilters) && (
        <div className="flex items-center gap-2 p-4 border-b">
          {showSearch && (
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search decisions..."
                className="pl-8"
              />
            </div>
          )}

          {showFilters && (
            <>
              <Select
                value={selectedType}
                onValueChange={(v) => setSelectedType(v as DecisionType | 'all')}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {Object.entries(DECISION_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={actorFilter}
                onValueChange={(v) => setActorFilter(v as 'all' | 'human' | 'system')}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Actor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="human">Human</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      )}

      {/* Decision List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading decisions...
            </div>
          ) : filteredDecisions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No decisions found</p>
              <p className="text-xs mt-1">
                Decisions are logged when you take actions
              </p>
            </div>
          ) : (
            filteredDecisions.map(decision => (
              <DecisionItem
                key={decision.id}
                decision={decision}
                onRate={handleRate}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// =========================================================================
// Utility Functions
// =========================================================================

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  // For older, show actual date
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default DecisionLog;
