/**
 * LivePortWarning - Full-screen warning when connected to LIVE trading port
 *
 * PHASE 1 SAFETY: Prevents accidental live trading
 *
 * Triggers when:
 * - IB port 7496 (TWS Live) detected
 * - IB port 4001 (Gateway Live) detected
 *
 * Behavior:
 * - Full-screen modal, cannot be dismissed without acknowledgment
 * - Plays critical.mp3 audio alert
 * - Logs connection to decisions table
 * - Header border turns red and pulses for entire session
 *
 * ADHD Design:
 * - Impossible to miss
 * - Requires explicit checkbox acknowledgment
 * - Logs the acknowledgment for audit trail
 */

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Shield, DollarSign, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// Live trading ports - CRITICAL to get right
const LIVE_PORTS = [7496, 4001]; // TWS Live, Gateway Live
const PAPER_PORTS = [7497, 4002]; // TWS Paper, Gateway Paper

interface LivePortWarningProps {
  /** Current connection port */
  port?: number;
  /** Account ID if available */
  accountId?: string;
  /** Current positions (for context) */
  positions?: Array<{ symbol: string; quantity: number }>;
  /** Called when user acknowledges and continues */
  onAcknowledge?: () => void;
  /** Called when user chooses to disconnect */
  onDisconnect?: () => void;
}

export function LivePortWarning({
  port,
  accountId,
  positions = [],
  onAcknowledge,
  onDisconnect,
}: LivePortWarningProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check port type
  const isLivePort = port !== undefined && LIVE_PORTS.includes(port);
  const isPaperPort = port !== undefined && PAPER_PORTS.includes(port);
  const isUnknownPort = port !== undefined && !isLivePort && !isPaperPort;

  // Play audio alert - MUST be defined BEFORE useEffect that uses it (TDZ fix)
  const playAudioAlert = useCallback(() => {
    try {
      const audio = new Audio('/sounds/critical.mp3');
      audio.play().catch(() => {
        console.warn('[LivePortWarning] Could not play audio alert');
      });
    } catch (err) {
      console.warn('[LivePortWarning] Audio not available');
    }
  }, []);

  // Open modal when connected to live port or unknown port
  useEffect(() => {
    if (isLivePort || isUnknownPort) {
      setIsOpen(true);
      playAudioAlert();
    }
  }, [isLivePort, isUnknownPort, playAudioAlert]);

  // Log to decisions table
  const logDecision = useCallback(async (action: 'acknowledged' | 'disconnected') => {
    try {
      await supabase.from('decisions').insert({
        decision_type: 'override',
        description: `Live trading port ${port} ${action}`,
        reason: action === 'acknowledged'
          ? 'User acknowledged live trading connection'
          : 'User chose to disconnect from live port',
        context: {
          port,
          accountId,
          positionCount: positions.length,
          positions: positions.slice(0, 10), // Limit for storage
        },
        actor: 'human',
      });
    } catch (err) {
      console.error('[LivePortWarning] Failed to log decision:', err);
    }
  }, [port, accountId, positions]);

  // Handle acknowledgment
  const handleAcknowledge = useCallback(async () => {
    if (!acknowledged) return;

    setIsLoading(true);
    await logDecision('acknowledged');
    setIsOpen(false);
    onAcknowledge?.();
    setIsLoading(false);
  }, [acknowledged, logDecision, onAcknowledge]);

  // Handle disconnect
  const handleDisconnect = useCallback(async () => {
    setIsLoading(true);
    await logDecision('disconnected');
    setIsOpen(false);
    onDisconnect?.();
    setIsLoading(false);
  }, [logDecision, onDisconnect]);

  // Don't render if paper port (safe) or no port
  if (isPaperPort || port === undefined) return null;

  return (
    <Dialog open={isOpen} onOpenChange={() => {/* Cannot dismiss without action */}}>
      <DialogContent
        className="sm:max-w-lg border-red-500 border-2"
        onInteractOutside={(e) => e.preventDefault()} // Prevent closing on outside click
        onEscapeKeyDown={(e) => e.preventDefault()} // Prevent ESC closing
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600 text-xl">
            <AlertTriangle className="h-6 w-6 animate-pulse" />
            {isUnknownPort
              ? '⚠️ UNKNOWN PORT - VERIFY TRADING MODE'
              : '⚠️ LIVE TRADING CONNECTION DETECTED'}
          </DialogTitle>
          <DialogDescription className="text-base">
            {isUnknownPort
              ? `Port ${port} is not recognized. This could be a live account. Verify before proceeding.`
              : 'You are connected to a LIVE trading account. Real money is at risk.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Connection Details */}
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Port:</span>
              <span className="font-mono font-bold text-red-600">{port}</span>
            </div>
            {accountId && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Account:</span>
                <span className="font-mono font-bold">{accountId}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Mode:</span>
              <span className="font-semibold text-red-600">
                {isUnknownPort ? 'UNKNOWN - VERIFY' : 'LIVE TRADING'}
              </span>
            </div>
          </div>

          {/* Current Positions Warning */}
          {positions.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-4 w-4 text-yellow-600" />
                <span className="font-medium text-yellow-600">
                  {positions.length} existing position{positions.length !== 1 ? 's' : ''} detected
                </span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                {positions.slice(0, 5).map((p, i) => (
                  <li key={i} className="font-mono">
                    {p.symbol}: {p.quantity > 0 ? '+' : ''}{p.quantity}
                  </li>
                ))}
                {positions.length > 5 && (
                  <li className="text-xs">...and {positions.length - 5} more</li>
                )}
              </ul>
            </div>
          )}

          {/* Safety Reminders */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-500" />
              <span className="font-medium">Before proceeding:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-6">
              <li>Verify you intend to trade with real money</li>
              <li>Check that position sizes are appropriate</li>
              <li>Ensure circuit breakers are properly configured</li>
              <li>Confirm you've completed paper trading graduation</li>
            </ul>
          </div>

          {/* Acknowledgment Checkbox */}
          <div className="flex items-start space-x-3 pt-2">
            <Checkbox
              id="acknowledge"
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="acknowledge"
              className="text-sm font-medium leading-tight cursor-pointer"
            >
              I understand this is REAL MONEY and I accept the risks of live trading
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleDisconnect}
            disabled={isLoading}
            className="flex-1"
          >
            Disconnect (Safer)
          </Button>
          <Button
            onClick={handleAcknowledge}
            disabled={!acknowledged || isLoading}
            className={cn(
              'flex-1',
              acknowledged
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {isLoading ? 'Processing...' : 'Continue with Live Trading'}
          </Button>
        </DialogFooter>

        {/* Paper Trading Link */}
        <div className="text-center text-xs text-muted-foreground pb-2">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleDisconnect();
            }}
            className="inline-flex items-center gap-1 hover:text-primary"
          >
            <ExternalLink className="h-3 w-3" />
            Switch to Paper Trading (Port 7497)
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default LivePortWarning;
