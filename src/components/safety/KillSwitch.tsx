/**
 * KillSwitch - Emergency stop button for all trading
 *
 * PHASE 1 SAFETY: This is the most critical UI component.
 * - Always visible in header (80px red button)
 * - 2-step confirmation with reason capture
 * - Logs to decisions table for audit trail
 * - Plays audio alert on activation
 *
 * ADHD Design:
 * - Unmistakable red, always in same position
 * - Cannot be accidentally triggered (requires confirm)
 * - Reason required (helps future-you understand why)
 */

import { useState, useCallback, useRef } from 'react';
import { AlertTriangle, StopCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

// Common reasons for kill switch (ADHD-friendly dropdown)
const COMMON_REASONS = [
  'Unexpected market behavior',
  'System malfunction detected',
  'Risk limit exceeded',
  'Connection issues',
  'Manual override for review',
  'Planned halt for maintenance',
  'Other (specify below)',
];

interface Position {
  symbol: string;
  quantity: number;
  marketValue?: number;
}

interface KillSwitchProps {
  /** Current open positions */
  positions?: Position[];
  /** Estimated P&L impact range */
  estimatedImpact?: { min: number; max: number };
  /** Callback after kill switch completes */
  onComplete?: (result: KillResult) => void;
  /** Custom class name */
  className?: string;
}

interface KillResult {
  success: boolean;
  ordersCancelled: number;
  positionsClosed: number;
  finalPnL?: number;
  error?: string;
}

type KillState = 'active' | 'confirming' | 'executing' | 'killed' | 'error';

export function KillSwitch({
  positions = [],
  estimatedImpact,
  onComplete,
  className,
}: KillSwitchProps) {
  const [state, setState] = useState<KillState>('active');
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState('');
  const [result, setResult] = useState<KillResult | null>(null);

  // CRITICAL FIX: Prevent double-click race condition
  const isExecutingRef = useRef(false);

  // Get final reason text
  const getFinalReason = useCallback(() => {
    if (selectedReason === 'Other (specify below)') {
      return customReason || 'Other (no details provided)';
    }
    return selectedReason;
  }, [selectedReason, customReason]);

  // Log to decisions table
  const logDecision = useCallback(async (reason: string, outcome: KillResult) => {
    try {
      await supabase.from('decisions').insert({
        decision_type: 'kill_switch',
        description: 'Emergency kill switch activated',
        reason,
        context: {
          positions: positions.map(p => ({ symbol: p.symbol, quantity: p.quantity })),
          positionCount: positions.length,
          estimatedImpact,
        },
        outcome: outcome.success ? 'success' : 'failed',
        outcome_pnl: outcome.finalPnL,
        actor: 'human',
      });
    } catch (err) {
      console.error('[KillSwitch] Failed to log decision:', err);
    }
  }, [positions, estimatedImpact]);

  // Play audio alert
  const playAudioAlert = useCallback(() => {
    try {
      const audio = new Audio('/sounds/critical.mp3');
      audio.play().catch(() => {
        // Audio might fail if file doesn't exist yet
        console.warn('[KillSwitch] Could not play audio alert');
      });
    } catch (err) {
      console.warn('[KillSwitch] Audio not available');
    }
  }, []);

  // Handle initial button click - open confirmation
  const handleClick = useCallback(() => {
    if (state === 'killed') {
      // Already killed, show result again
      setShowConfirm(true);
      return;
    }
    if (state === 'executing') return;

    setState('confirming');
    setShowConfirm(true);
  }, [state]);

  // Handle confirmation
  const handleConfirm = useCallback(async () => {
    const reason = getFinalReason();
    if (!reason) return;

    // CRITICAL FIX: Prevent double-click race condition
    if (isExecutingRef.current) {
      console.warn('[KillSwitch] Already executing, ignoring duplicate click');
      return;
    }
    isExecutingRef.current = true;

    setState('executing');
    playAudioAlert();

    // CRITICAL FIX: 5-second timeout for kill switch call
    const KILL_TIMEOUT_MS = 5000;

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Kill switch timed out after 5 seconds')), KILL_TIMEOUT_MS);
      });

      // Call the kill switch via Electron IPC with timeout
      const killPromise = window.electron?.trading?.killSwitch?.(reason, { all: true });

      // Handle case where electron API is not available
      if (!killPromise) {
        throw new Error('Trading API not available - not connected to Electron');
      }

      const response = await Promise.race([killPromise, timeoutPromise]);

      const killResult: KillResult = {
        success: response?.success ?? false,
        ordersCancelled: response?.ordersCancelled ?? 0,
        positionsClosed: response?.positionsClosed ?? positions.length,
        finalPnL: response?.finalPnL,
        error: response?.error,
      };

      setResult(killResult);
      setState(killResult.success ? 'killed' : 'error');

      // CRITICAL FIX: Fire-and-forget logging - don't block UI
      logDecision(reason, killResult).catch(err => {
        console.error('[KillSwitch] Background logging failed:', err);
      });

      // Notify parent immediately
      onComplete?.(killResult);
    } catch (err) {
      const errorResult: KillResult = {
        success: false,
        ordersCancelled: 0,
        positionsClosed: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
      setResult(errorResult);
      setState('error');

      // CRITICAL FIX: Fire-and-forget logging - don't block UI
      logDecision(reason, errorResult).catch(logErr => {
        console.error('[KillSwitch] Background logging failed:', logErr);
      });

      onComplete?.(errorResult);
    } finally {
      // Reset the ref after execution completes
      isExecutingRef.current = false;
    }
  }, [getFinalReason, positions, playAudioAlert, logDecision, onComplete]);

  // Cancel confirmation
  const handleCancel = useCallback(() => {
    setShowConfirm(false);
    setState('active');
    setSelectedReason('');
    setCustomReason('');
  }, []);

  // Format position summary
  const positionSummary = positions.length > 0
    ? positions.map(p => `${p.symbol}: ${p.quantity > 0 ? '+' : ''}${p.quantity}`).join(', ')
    : 'No open positions';

  // Format impact estimate
  const impactText = estimatedImpact
    ? `${estimatedImpact.min < 0 ? '-' : ''}$${Math.abs(estimatedImpact.min)} to ${estimatedImpact.max < 0 ? '-' : ''}$${Math.abs(estimatedImpact.max)}`
    : 'Unknown';

  // Determine button appearance based on state
  const buttonConfig = {
    active: { text: 'STOP ALL', bg: 'bg-red-600 hover:bg-red-700' },
    confirming: { text: 'STOP ALL', bg: 'bg-red-600 hover:bg-red-700' },
    executing: { text: 'STOPPING...', bg: 'bg-yellow-600' },
    killed: { text: 'STOPPED ✓', bg: 'bg-green-600 hover:bg-green-700' },
    error: { text: 'ERROR ✗', bg: 'bg-red-800 hover:bg-red-900' },
  };

  const config = buttonConfig[state];

  return (
    <>
      {/* Kill Switch Button - Always visible in header */}
      <Button
        onClick={handleClick}
        disabled={state === 'executing'}
        className={cn(
          'h-full px-4 font-bold text-white border-0',
          'transition-all duration-200',
          config.bg,
          state === 'executing' && 'cursor-wait',
          className
        )}
      >
        {state === 'executing' ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <StopCircle className="h-4 w-4 mr-1" />
        )}
        {config.text}
      </Button>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              EMERGENCY STOP
            </DialogTitle>
            <DialogDescription>
              This will immediately cancel all orders and flatten all positions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* What will happen */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
              <p className="font-medium">This action will:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Cancel all pending orders</li>
                <li>Flatten all open positions at market</li>
                <li>Halt all automated trading</li>
              </ul>
            </div>

            {/* Current positions */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Current positions</Label>
              <p className="text-sm font-mono bg-muted/30 rounded px-2 py-1">
                {positionSummary}
              </p>
            </div>

            {/* Estimated impact */}
            {estimatedImpact && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Estimated P&L impact</Label>
                <p className="text-sm font-mono bg-muted/30 rounded px-2 py-1">
                  {impactText}
                </p>
              </div>
            )}

            {/* Reason selection (REQUIRED) */}
            <div className="space-y-2">
              <Label htmlFor="reason" className="font-medium">
                Reason <span className="text-red-500">*</span>
              </Label>
              <Select value={selectedReason} onValueChange={setSelectedReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_REASONS.map(reason => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Custom reason text */}
            {selectedReason === 'Other (specify below)' && (
              <div className="space-y-2">
                <Label htmlFor="customReason">Details</Label>
                <Textarea
                  id="customReason"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Describe why you're stopping..."
                  className="min-h-[80px]"
                />
              </div>
            )}

            {/* Result display */}
            {result && (
              <div className={cn(
                'rounded-lg p-3 text-sm',
                result.success ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
              )}>
                {result.success ? (
                  <p>
                    ✓ Closed {result.positionsClosed} positions, cancelled {result.ordersCancelled} orders
                    {result.finalPnL !== undefined && ` (P&L: $${result.finalPnL.toFixed(2)})`}
                  </p>
                ) : (
                  <p>✗ Error: {result.error}</p>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={state === 'executing'}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!selectedReason || (selectedReason === 'Other (specify below)' && !customReason) || state === 'executing' || state === 'killed'}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {state === 'executing' ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Stopping...
                </>
              ) : state === 'killed' ? (
                'Completed'
              ) : (
                <>
                  <StopCircle className="h-4 w-4 mr-2" />
                  CONFIRM STOP ALL
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default KillSwitch;
