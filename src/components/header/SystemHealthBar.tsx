/**
 * SystemHealthBar - Header status strip showing all critical system info
 *
 * PHASE 1 SAFETY: Always visible, always same position
 *
 * Layout (left to right):
 * [STOP ALL] | [$+1,234] | [TREND ↗] | [ES: Open 2h] | [🟢🟢🟢] | [⚠️3] | [⌘K]
 *
 * ADHD Design:
 * - Fixed 48px height, never scrolls
 * - Same elements in same positions always
 * - Color-coded for at-a-glance understanding
 * - Every number explained on hover
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Clock,
  Command,
  Wifi,
  WifiOff,
  Database,
  Cpu,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { KillSwitch } from '@/components/safety/KillSwitch';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';

// =========================================================================
// Types
// =========================================================================

type Regime = 'trending' | 'meanReverting' | 'volatile' | 'uncertain';
type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

interface Position {
  symbol: string;
  quantity: number;
  marketValue?: number;
}

interface SystemHealthBarProps {
  /** Called when ⌘K is clicked */
  onCommandPalette?: () => void;
  /** Called when alert badge is clicked */
  onAlertClick?: () => void;
  /** Alert count */
  alertCount?: number;
  /** Custom class name */
  className?: string;
}

// =========================================================================
// Regime Display Component
// =========================================================================

const REGIME_CONFIG: Record<Regime, { label: string; icon: string; color: string; tooltip: string }> = {
  trending: {
    label: 'TREND',
    icon: '↗',
    color: 'text-green-500 bg-green-500/10 border-green-500/30',
    tooltip: 'Market trending. Momentum strategies favored.',
  },
  meanReverting: {
    label: 'MEAN',
    icon: '↔',
    color: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
    tooltip: 'Range-bound. Mean reversion strategies favored.',
  },
  volatile: {
    label: 'VOL',
    icon: '⚡',
    color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30',
    tooltip: 'High volatility. Reduced position sizes recommended.',
  },
  uncertain: {
    label: '???',
    icon: '',
    color: 'text-muted-foreground bg-muted/50 border-muted-foreground/30',
    tooltip: 'Regime unclear. System may reduce exposure.',
  },
};

function RegimeIndicator({ regime, confidence }: { regime: Regime; confidence: number }) {
  const config = REGIME_CONFIG[regime];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn('gap-1 px-2 py-1 cursor-default', config.color)}
          >
            <span className="font-semibold">{config.label}</span>
            <span>{config.icon}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{config.tooltip}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Confidence: {Math.round(confidence)}%
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =========================================================================
// P&L Display Component
// =========================================================================

function PnLDisplay({ pnl, pnlPercent }: { pnl: number; pnlPercent: number }) {
  const isPositive = pnl >= 0;
  const formatted = `${isPositive ? '+' : '-'}$${Math.abs(pnl).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              'gap-1 px-2 py-1 cursor-pointer font-mono',
              isPositive
                ? 'text-green-500 bg-green-500/10 border-green-500/30'
                : 'text-red-500 bg-red-500/10 border-red-500/30'
            )}
          >
            {isPositive ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            <span className="font-semibold">{formatted}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">Today's P&L</p>
          <p className="text-xs text-muted-foreground">
            {isPositive ? '+' : ''}{pnlPercent.toFixed(2)}% of portfolio
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Click to view full P&L dashboard
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =========================================================================
// Market Hours Display Component
// =========================================================================

function MarketHoursDisplay({
  symbol,
  isOpen,
  timeUntilChange,
}: {
  symbol: string;
  isOpen: boolean;
  timeUntilChange: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              'gap-1 px-2 py-1 cursor-default',
              isOpen
                ? 'text-green-500 bg-green-500/10 border-green-500/30'
                : 'text-muted-foreground bg-muted/50 border-muted-foreground/30'
            )}
          >
            <Clock className="h-3 w-3" />
            <span>{symbol}:</span>
            <span className="font-semibold">
              {isOpen ? 'Open' : 'Closed'}
            </span>
            <span className="text-xs">({timeUntilChange})</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">
            {symbol} {isOpen ? 'closes' : 'opens'} in {timeUntilChange}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            ES futures: Sun 5pm - Fri 4pm CT
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =========================================================================
// Status Dots Component
// =========================================================================

interface StatusDotsProps {
  ibConnection: { status: ConnectionStatus; port?: number; isLive?: boolean };
  dataFeed: { status: 'live' | 'delayed' | 'stale' };
  pipeline: { status: 'running' | 'idle' | 'error' };
}

function StatusDots({ ibConnection, dataFeed, pipeline }: StatusDotsProps) {
  const getColor = (status: string) => {
    switch (status) {
      case 'connected':
      case 'live':
      case 'running':
        return 'bg-green-500';
      case 'connecting':
      case 'delayed':
      case 'idle':
        return 'bg-yellow-500';
      default:
        return 'bg-red-500';
    }
  };

  const ibColor = ibConnection.isLive
    ? 'bg-red-500 animate-pulse ring-2 ring-red-500/50'
    : getColor(ibConnection.status);

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        {/* IB Connection */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full cursor-default',
                ibColor
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">IBKR Connection</p>
            <p className="text-xs text-muted-foreground">
              Status: {ibConnection.status}
              {ibConnection.port && ` (Port ${ibConnection.port})`}
            </p>
            {ibConnection.isLive && (
              <p className="text-xs text-red-500 font-semibold mt-1">
                ⚠️ LIVE TRADING ENABLED
              </p>
            )}
          </TooltipContent>
        </Tooltip>

        {/* Data Feed */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full cursor-default',
                getColor(dataFeed.status)
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Data Feed</p>
            <p className="text-xs text-muted-foreground">
              Status: {dataFeed.status}
            </p>
          </TooltipContent>
        </Tooltip>

        {/* Pipeline */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full cursor-default',
                getColor(pipeline.status)
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">Pipeline</p>
            <p className="text-xs text-muted-foreground">
              Status: {pipeline.status}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

// =========================================================================
// Alert Badge Component
// =========================================================================

function AlertBadge({ count, onClick }: { count: number; onClick?: () => void }) {
  if (count === 0) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            className={cn(
              'h-8 px-2 gap-1',
              count > 0 && 'text-yellow-500 hover:text-yellow-600'
            )}
          >
            <AlertTriangle className="h-4 w-4" />
            <span className="font-semibold">{count}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{count} unread alert{count !== 1 ? 's' : ''}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Click to view Alert Center
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =========================================================================
// Main Component
// =========================================================================

export function SystemHealthBar({
  onCommandPalette,
  onAlertClick,
  alertCount = 0,
  className,
}: SystemHealthBarProps) {
  const navigate = useNavigate();
  const { isConnected } = useJarvisEvents();

  // State - in production these would come from hooks/context
  const [pnl] = useState(1234);
  const [pnlPercent] = useState(0.23);
  const [regime] = useState<Regime>('trending');
  const [regimeConfidence] = useState(78);
  const [positions] = useState<Position[]>([
    { symbol: 'ES', quantity: 2, marketValue: 12000 },
    { symbol: 'NQ', quantity: -1, marketValue: -5000 },
  ]);
  const [marketOpen] = useState(true);
  const [timeUntilChange] = useState('2h 34m');

  // Connection status
  const [ibConnection] = useState<StatusDotsProps['ibConnection']>({
    status: 'connected',
    port: 7497,
    isLive: false,
  });
  const [dataFeed] = useState<StatusDotsProps['dataFeed']>({ status: 'live' });
  const [pipeline] = useState<StatusDotsProps['pipeline']>({ status: 'idle' });

  // Calculate estimated impact (simplified)
  const estimatedImpact = positions.length > 0
    ? { min: -890, max: -450 }
    : undefined;

  return (
    <header
      className={cn(
        'flex items-center justify-between px-2 h-12 border-b bg-card/50 backdrop-blur sticky top-0 z-50',
        className
      )}
    >
      {/* Left Section: Kill Switch + P&L */}
      <div className="flex items-center gap-2">
        {/* Kill Switch - Always first, always visible */}
        <KillSwitch
          positions={positions}
          estimatedImpact={estimatedImpact}
          className="h-9"
        />

        {/* P&L Display */}
        <PnLDisplay pnl={pnl} pnlPercent={pnlPercent} />
      </div>

      {/* Center Section: Regime + Market Hours */}
      <div className="flex items-center gap-2">
        <RegimeIndicator regime={regime} confidence={regimeConfidence} />
        <MarketHoursDisplay
          symbol="ES"
          isOpen={marketOpen}
          timeUntilChange={timeUntilChange}
        />
      </div>

      {/* Right Section: Status + Alerts + Command */}
      <div className="flex items-center gap-3">
        {/* Status Dots */}
        <StatusDots
          ibConnection={ibConnection}
          dataFeed={dataFeed}
          pipeline={pipeline}
        />

        {/* Alert Badge */}
        <AlertBadge count={alertCount} onClick={onAlertClick} />

        {/* Command Palette Hint */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCommandPalette}
                className="h-8 px-2"
              >
                <kbd className="flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground">
                  <Command className="h-2.5 w-2.5" />K
                </kbd>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Open Command Palette</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  );
}

export default SystemHealthBar;
