/**
 * SessionResume - Context restoration after absence
 *
 * PHASE 3: ADHD Cognitive Support
 *
 * Behavior by absence duration:
 * - < 30 min: No interruption, subtle badge on AlertCenter
 * - 30 min - 4 hr: Slide-in panel (not modal), dismissible
 * - 4 hr - 24 hr: Modal, must review before dismissing
 * - > 24 hr: Full modal + audio chime + force review
 *
 * ADHD Design:
 * - Grouped by category (Money, Market, Attention, Completed)
 * - Color-coded sections for quick scanning
 * - Plain English descriptions
 * - Shows what you were working on
 */

import { useState, useEffect, useCallback } from 'react';
import {
  DollarSign,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  MapPin,
  Clock,
  TrendingUp,
  TrendingDown,
  Activity,
  Calendar,
  X,
  ChevronRight,
  Play,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// =========================================================================
// Types
// =========================================================================

interface Position {
  symbol: string;
  quantity: number;
  pnl: number;
}

interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
}

interface Strategy {
  id: string;
  name: string;
  consecutiveLosses: number;
}

interface Decision {
  id: string;
  title: string;
  createdAt: Date;
}

interface SessionContext {
  lastActiveAt: Date;
  hoursAway: number;

  // Market context
  regimeWhenLeft: string;
  regimeNow: string;
  regimeChanged: boolean;

  // What happened
  pnlChange: number;
  pnlChangePercent: number;
  eventsCount: number;
  criticalAlerts: Alert[];
  strategiesValidated: number;
  strategiesPromoted: number;
  strategiesDegraded: Strategy[];
  backtestsCompleted: number;

  // Where user was
  lastFocus: string | null;
  pendingDecisions: Decision[];

  // Current state
  openPositions: Position[];
  riskLimitUsage: number; // 0-100%
  marketOpen: boolean;
  timeUntilMarketChange: string;
  vix: number | null;
}

interface SessionResumeProps {
  context: SessionContext | null;
  onDismiss: () => void;
  onViewActivityLog: () => void;
  className?: string;
}

// =========================================================================
// Helpers
// =========================================================================

function formatDuration(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} minute${mins !== 1 ? 's' : ''}`;
  }
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (m === 0) return `${h} hour${h !== 1 ? 's' : ''}`;
    return `${h} hour${h !== 1 ? 's' : ''} ${m} minute${m !== 1 ? 's' : ''}`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  if (remainingHours === 0) return `${days} day${days !== 1 ? 's' : ''}`;
  return `${days} day${days !== 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
}

const REGIME_LABELS: Record<string, string> = {
  trending: 'TRENDING',
  meanReverting: 'MEAN-REVERTING',
  volatile: 'VOLATILE',
  uncertain: 'UNCERTAIN',
};

const REGIME_COLORS: Record<string, string> = {
  trending: 'text-green-500',
  meanReverting: 'text-blue-500',
  volatile: 'text-yellow-500',
  uncertain: 'text-gray-500',
};

// =========================================================================
// Section Components
// =========================================================================

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}

function Section({ icon, title, children, className }: SectionProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <h3 className="flex items-center gap-2 font-medium text-sm">
        {icon}
        {title}
      </h3>
      <div className="pl-6 space-y-1 text-sm">{children}</div>
    </div>
  );
}

function TreeItem({
  children,
  isLast = false,
}: {
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground">{isLast ? '└─' : '├─'}</span>
      <span>{children}</span>
    </div>
  );
}

// =========================================================================
// Main Content Component (shared between modal and panel)
// =========================================================================

function SessionResumeContent({
  context,
  onDismiss,
  onViewActivityLog,
  isModal = false,
}: {
  context: SessionContext;
  onDismiss: () => void;
  onViewActivityLog: () => void;
  isModal?: boolean;
}) {
  const hasAttentionItems =
    context.criticalAlerts.length > 0 ||
    context.strategiesDegraded.length > 0 ||
    context.riskLimitUsage > 70;

  const hasCompletedItems =
    context.strategiesValidated > 0 ||
    context.backtestsCompleted > 0 ||
    context.strategiesPromoted > 0;

  return (
    <ScrollArea className="max-h-[70vh]">
      <div className="space-y-6 p-1">
        {/* Money Section */}
        <Section
          icon={<DollarSign className="h-4 w-4 text-green-500" />}
          title="MONEY"
        >
          <TreeItem>
            P&L while away:{' '}
            <span
              className={cn(
                'font-mono font-medium',
                context.pnlChange >= 0 ? 'text-green-500' : 'text-red-500'
              )}
            >
              {context.pnlChange >= 0 ? '+' : ''}$
              {context.pnlChange.toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}{' '}
              ({context.pnlChangePercent >= 0 ? '+' : ''}
              {context.pnlChangePercent.toFixed(2)}%)
            </span>
          </TreeItem>
          <TreeItem>
            Current positions:{' '}
            <span className="font-medium">{context.openPositions.length} open</span>
          </TreeItem>
          {context.openPositions.length > 0 && (
            <TreeItem isLast>
              Largest move:{' '}
              {(() => {
                const sorted = [...context.openPositions].sort(
                  (a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)
                );
                const largest = sorted[0];
                return (
                  <span
                    className={cn(
                      'font-mono',
                      largest.pnl >= 0 ? 'text-green-500' : 'text-red-500'
                    )}
                  >
                    {largest.symbol} {largest.pnl >= 0 ? '+' : ''}$
                    {largest.pnl.toLocaleString()}
                  </span>
                );
              })()}
            </TreeItem>
          )}
        </Section>

        {/* Market Context Section */}
        <Section
          icon={<BarChart3 className="h-4 w-4 text-blue-500" />}
          title="MARKET CONTEXT"
        >
          <TreeItem>
            Regime:{' '}
            <span className={cn('font-medium', REGIME_COLORS[context.regimeNow])}>
              {REGIME_LABELS[context.regimeNow] || context.regimeNow}
            </span>
            {context.regimeChanged && (
              <span className="text-muted-foreground">
                {' '}
                (was {REGIME_LABELS[context.regimeWhenLeft] || context.regimeWhenLeft}{' '}
                when you left)
              </span>
            )}
          </TreeItem>
          <TreeItem>
            Market:{' '}
            <span className="font-medium">
              {context.marketOpen ? 'Currently open' : 'Closed'}
            </span>
            {context.timeUntilMarketChange && (
              <span className="text-muted-foreground">
                , {context.marketOpen ? 'closes' : 'opens'} in{' '}
                {context.timeUntilMarketChange}
              </span>
            )}
          </TreeItem>
          {context.vix !== null && (
            <TreeItem isLast>
              VIX:{' '}
              <span
                className={cn(
                  'font-mono',
                  context.vix > 25
                    ? 'text-red-500'
                    : context.vix > 20
                      ? 'text-yellow-500'
                      : 'text-green-500'
                )}
              >
                {context.vix.toFixed(1)}
              </span>
              <span className="text-muted-foreground">
                {' '}
                ({context.vix > 25 ? 'elevated' : context.vix > 20 ? 'moderate' : 'normal'})
              </span>
            </TreeItem>
          )}
        </Section>

        {/* Requires Attention Section */}
        {hasAttentionItems && (
          <Section
            icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
            title={`REQUIRES ATTENTION (${context.criticalAlerts.length + context.strategiesDegraded.length + (context.riskLimitUsage > 70 ? 1 : 0)})`}
          >
            {context.criticalAlerts.map((alert, index) => (
              <TreeItem key={alert.id}>
                <span className="text-red-500">{alert.title}</span>
              </TreeItem>
            ))}
            {context.strategiesDegraded.map((strategy) => (
              <TreeItem key={strategy.id}>
                Strategy "{strategy.name}" showing degradation (
                {strategy.consecutiveLosses} consecutive losses)
              </TreeItem>
            ))}
            {context.riskLimitUsage > 70 && (
              <TreeItem isLast>
                Daily loss limit{' '}
                <span
                  className={cn(
                    'font-mono',
                    context.riskLimitUsage > 90 ? 'text-red-500' : 'text-yellow-500'
                  )}
                >
                  {context.riskLimitUsage.toFixed(0)}%
                </span>{' '}
                consumed
              </TreeItem>
            )}
          </Section>
        )}

        {/* Completed While Away Section */}
        {hasCompletedItems && (
          <Section
            icon={<CheckCircle className="h-4 w-4 text-green-500" />}
            title="COMPLETED WHILE AWAY"
          >
            {context.strategiesValidated > 0 && (
              <TreeItem>
                {context.strategiesValidated} strateg
                {context.strategiesValidated === 1 ? 'y' : 'ies'} validated
              </TreeItem>
            )}
            {context.backtestsCompleted > 0 && (
              <TreeItem>
                {context.backtestsCompleted} backtest
                {context.backtestsCompleted === 1 ? '' : 's'} completed
              </TreeItem>
            )}
            {context.strategiesPromoted > 0 && (
              <TreeItem isLast>
                {context.strategiesPromoted} strateg
                {context.strategiesPromoted === 1 ? 'y' : 'ies'} promoted to paper trading
              </TreeItem>
            )}
          </Section>
        )}

        {/* Where You Left Off Section */}
        {context.lastFocus && (
          <Section
            icon={<MapPin className="h-4 w-4 text-purple-500" />}
            title="YOU WERE WORKING ON"
          >
            <TreeItem isLast>"{context.lastFocus}"</TreeItem>
          </Section>
        )}

        {/* Pending Decisions */}
        {context.pendingDecisions.length > 0 && (
          <Section
            icon={<Clock className="h-4 w-4 text-orange-500" />}
            title={`PENDING DECISIONS (${context.pendingDecisions.length})`}
          >
            {context.pendingDecisions.map((decision, index) => (
              <TreeItem
                key={decision.id}
                isLast={index === context.pendingDecisions.length - 1}
              >
                {decision.title}
              </TreeItem>
            ))}
          </Section>
        )}
      </div>
    </ScrollArea>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function SessionResume({
  context,
  onDismiss,
  onViewActivityLog,
  className,
}: SessionResumeProps) {
  const [hasReviewedAlerts, setHasReviewedAlerts] = useState(false);

  // Determine display mode based on absence duration
  const getDisplayMode = useCallback(() => {
    if (!context) return 'none';
    if (context.hoursAway < 0.5) return 'badge'; // < 30 min
    if (context.hoursAway < 4) return 'panel'; // 30 min - 4 hr
    if (context.hoursAway < 24) return 'modal'; // 4 hr - 24 hr
    return 'fullModal'; // > 24 hr
  }, [context]);

  const displayMode = getDisplayMode();

  // Play audio chime for > 24 hr absence
  useEffect(() => {
    if (displayMode === 'fullModal') {
      try {
        const audio = new Audio('/sounds/chime.mp3');
        audio.play().catch(() => {
          // Audio playback may be blocked by browser
          console.log('[SessionResume] Audio blocked by browser');
        });
      } catch (e) {
        console.log('[SessionResume] Audio not available');
      }
    }
  }, [displayMode]);

  // Can dismiss only if:
  // - Not fullModal, OR
  // - Has reviewed critical alerts (or no critical alerts)
  const canDismiss =
    displayMode !== 'fullModal' ||
    !context?.criticalAlerts.length ||
    hasReviewedAlerts;

  if (!context || displayMode === 'none' || displayMode === 'badge') {
    return null;
  }

  // Panel mode (30 min - 4 hr)
  if (displayMode === 'panel') {
    return (
      <Sheet open onOpenChange={(open) => !open && onDismiss()}>
        <SheetContent className={cn('w-[400px]', className)}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Welcome back
            </SheetTitle>
            <SheetDescription>
              You were away for {formatDuration(context.hoursAway)}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6">
            <SessionResumeContent
              context={context}
              onDismiss={onDismiss}
              onViewActivityLog={onViewActivityLog}
            />
          </div>

          <div className="mt-6 flex gap-2">
            <Button variant="outline" onClick={onViewActivityLog} className="flex-1">
              View Activity Log
            </Button>
            <Button onClick={onDismiss} className="flex-1">
              <Play className="h-4 w-4 mr-2" />
              Resume Work
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Modal mode (4+ hours)
  return (
    <Dialog open onOpenChange={(open) => !open && canDismiss && onDismiss()}>
      <DialogContent
        className={cn(
          'max-w-lg',
          displayMode === 'fullModal' && 'max-w-2xl',
          className
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Welcome back
            {displayMode === 'fullModal' && (
              <Badge variant="secondary" className="ml-2">
                <Volume2 className="h-3 w-3 mr-1" />
                Extended absence
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            You were away for {formatDuration(context.hoursAway)}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <SessionResumeContent
          context={context}
          onDismiss={onDismiss}
          onViewActivityLog={onViewActivityLog}
          isModal
        />

        {/* Force review of critical alerts for > 24 hr absence */}
        {displayMode === 'fullModal' && context.criticalAlerts.length > 0 && (
          <>
            <Separator />
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <h4 className="font-medium text-red-500 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Review Required
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                You must acknowledge the critical alerts above before continuing.
              </p>
              {!hasReviewedAlerts && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="mt-2"
                  onClick={() => setHasReviewedAlerts(true)}
                >
                  I have reviewed the alerts
                </Button>
              )}
              {hasReviewedAlerts && (
                <Badge variant="outline" className="mt-2 text-green-500 border-green-500">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Acknowledged
                </Badge>
              )}
            </div>
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onViewActivityLog}>
            View Full Activity Log
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={!canDismiss}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Start Fresh
          </Button>
          <Button onClick={onDismiss} disabled={!canDismiss}>
            <Play className="h-4 w-4 mr-2" />
            Resume Work
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SessionResume;
