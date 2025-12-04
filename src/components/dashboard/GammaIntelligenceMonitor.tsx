/**
 * GammaIntelligenceMonitor.tsx - Real-Time Gamma Intelligence Display
 *
 * Subscribes to Supabase dealer_positioning and gamma_walls tables
 * to display gamma exposure data calculated by Python.
 *
 * Architecture:
 *   Python (gamma_calc.py) → Supabase (tables) → React (this component)
 *
 * NO MOCK DATA - Real Supabase connection with realtime subscriptions.
 *
 * Created: 2025-12-04
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Shield,
  Target,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase, isSupabaseConfigured } from '@/integrations/supabase/client';

// Types matching the Supabase schema
interface DealerPositioning {
  id: string;
  symbol: string;
  positioning: 'LONG_GAMMA' | 'SHORT_GAMMA' | 'NEUTRAL';
  positioning_strength: number;
  net_gamma: number;
  call_gamma: number | null;
  put_gamma: number | null;
  gamma_notional: number | null;
  spot_price: number;
  zero_gamma_level: number | null;
  vol_impact: 'AMPLIFIED' | 'DAMPENED' | 'NEUTRAL';
  calculation_timestamp: string;
  updated_at: string;
}

interface GammaWall {
  id: string;
  symbol: string;
  strike: number;
  wall_type: 'SUPPORT' | 'RESISTANCE' | 'MAGNET' | 'FLIP_ZONE';
  wall_strength: number;
  distance_from_spot: number;
  gamma_at_strike: number | null;
  open_interest: number | null;
  updated_at: string;
}

interface MarketRegime {
  id: string;
  is_current: boolean;
  vix_level: number;
  vix_regime: string;
  spy_price: number | null;
  spy_trend: string | null;
  sma_20: number | null;
  sma_50: number | null;
  sma_200: number | null;
  sector_correlation: number | null;
  correlation_regime: string | null;
  position_multiplier: number;
  updated_at: string;
}

// Format large numbers
function formatGamma(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  } else if (absValue >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  } else if (absValue >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

function GammaIntelligenceMonitorComponent() {
  // Connection state
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Data state
  const [positioning, setPositioning] = useState<DealerPositioning | null>(null);
  const [walls, setWalls] = useState<GammaWall[]>([]);
  const [regime, setRegime] = useState<MarketRegime | null>(null);

  // Selected symbol (default SPY)
  const [symbol] = useState('SPY');

  // Check connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      if (!isSupabaseConfigured) {
        setConnected(false);
        setError('Supabase not configured - check environment variables');
        setLoading(false);
        return;
      }

      try {
        const { error: testError } = await supabase
          .from('dealer_positioning')
          .select('id')
          .limit(1);

        if (testError) {
          if (testError.code === '42P01') {
            setConnected(true);
            setError('Gamma tables not found - run migrations first');
          } else {
            setConnected(false);
            setError(`Connection failed: ${testError.message}`);
          }
        } else {
          setConnected(true);
          setError(null);
        }
      } catch (err) {
        setConnected(false);
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
      setLoading(false);
    };

    checkConnection();
  }, []);

  // Fetch positioning data
  const fetchPositioning = useCallback(async () => {
    if (!connected) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('dealer_positioning')
        .select('*')
        .eq('symbol', symbol)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('[GammaMonitor] Positioning fetch error:', fetchError);
      }

      setPositioning(data || null);
    } catch (err) {
      console.error('[GammaMonitor] Error fetching positioning:', err);
    }
  }, [connected, symbol]);

  // Fetch walls
  const fetchWalls = useCallback(async () => {
    if (!connected) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('gamma_walls')
        .select('*')
        .eq('symbol', symbol)
        .order('wall_strength', { ascending: false });

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('[GammaMonitor] Walls fetch error:', fetchError);
      }

      setWalls(data || []);
    } catch (err) {
      console.error('[GammaMonitor] Error fetching walls:', err);
    }
  }, [connected, symbol]);

  // Fetch regime
  const fetchRegime = useCallback(async () => {
    if (!connected) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('market_regime_live')
        .select('*')
        .eq('is_current', true)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('[GammaMonitor] Regime fetch error:', fetchError);
      }

      setRegime(data || null);
    } catch (err) {
      console.error('[GammaMonitor] Error fetching regime:', err);
    }
  }, [connected]);

  // Subscribe to updates
  useEffect(() => {
    if (!connected) return;

    // Initial fetch
    fetchPositioning();
    fetchWalls();
    fetchRegime();

    // Real-time subscriptions
    const positioningChannel = supabase
      .channel('gamma-positioning')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dealer_positioning',
          filter: `symbol=eq.${symbol}`,
        },
        (payload) => {
          console.log('[GammaMonitor] Positioning update:', payload);
          fetchPositioning();
        }
      )
      .subscribe();

    const wallsChannel = supabase
      .channel('gamma-walls')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'gamma_walls',
          filter: `symbol=eq.${symbol}`,
        },
        (payload) => {
          console.log('[GammaMonitor] Walls update:', payload);
          fetchWalls();
        }
      )
      .subscribe();

    const regimeChannel = supabase
      .channel('market-regime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'market_regime_live',
        },
        (payload) => {
          console.log('[GammaMonitor] Regime update:', payload);
          fetchRegime();
        }
      )
      .subscribe();

    // Backup polling every 10 seconds
    const interval = setInterval(() => {
      fetchPositioning();
      fetchWalls();
      fetchRegime();
    }, 10000);

    return () => {
      positioningChannel.unsubscribe();
      wallsChannel.unsubscribe();
      regimeChannel.unsubscribe();
      clearInterval(interval);
    };
  }, [connected, symbol, fetchPositioning, fetchWalls, fetchRegime]);

  // Render positioning badge
  const renderPositioningBadge = () => {
    if (!positioning) return null;

    const isLong = positioning.positioning === 'LONG_GAMMA';
    const isShort = positioning.positioning === 'SHORT_GAMMA';

    return (
      <Badge
        variant="outline"
        className={cn(
          'text-sm font-medium',
          isLong && 'border-green-500 text-green-400 bg-green-500/10',
          isShort && 'border-red-500 text-red-400 bg-red-500/10',
          !isLong && !isShort && 'border-gray-500 text-gray-400'
        )}
      >
        {isLong && <Shield className="w-3 h-3 mr-1" />}
        {isShort && <Zap className="w-3 h-3 mr-1" />}
        {positioning.positioning.replace('_', ' ')}
      </Badge>
    );
  };

  // Render vol impact
  const renderVolImpact = () => {
    if (!positioning) return null;

    const isAmplified = positioning.vol_impact === 'AMPLIFIED';
    const isDampened = positioning.vol_impact === 'DAMPENED';

    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Vol Impact:</span>
        <span
          className={cn(
            'font-medium',
            isAmplified && 'text-red-400',
            isDampened && 'text-green-400',
            !isAmplified && !isDampened && 'text-gray-400'
          )}
        >
          {positioning.vol_impact}
        </span>
      </div>
    );
  };

  // Render wall
  const renderWall = (wall: GammaWall) => {
    const isSupport = wall.wall_type === 'SUPPORT';
    const isResistance = wall.wall_type === 'RESISTANCE';
    const isMagnet = wall.wall_type === 'MAGNET';

    return (
      <div
        key={wall.id}
        className={cn(
          'flex items-center justify-between p-2 rounded border',
          isSupport && 'border-green-500/30 bg-green-500/5',
          isResistance && 'border-red-500/30 bg-red-500/5',
          isMagnet && 'border-yellow-500/30 bg-yellow-500/5'
        )}
      >
        <div className="flex items-center gap-2">
          {isSupport && <TrendingUp className="w-4 h-4 text-green-400" />}
          {isResistance && <TrendingDown className="w-4 h-4 text-red-400" />}
          {isMagnet && <Target className="w-4 h-4 text-yellow-400" />}
          <span className="font-mono">${wall.strike.toFixed(0)}</span>
          <Badge variant="outline" className="text-xs">
            {wall.wall_type}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {wall.distance_from_spot > 0 ? '+' : ''}
            {wall.distance_from_spot.toFixed(2)}
          </span>
          <Progress value={wall.wall_strength} className="w-16 h-2" />
        </div>
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <Card className="bg-background/50 border-border/50">
        <CardContent className="p-6 flex items-center justify-center">
          <Activity className="w-5 h-5 animate-spin mr-2" />
          <span>Connecting to Gamma Intelligence...</span>
        </CardContent>
      </Card>
    );
  }

  // Not connected
  if (!connected) {
    return (
      <Card className="bg-background/50 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="w-5 h-5" />
            Gamma Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{error || 'Not connected'}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // No data yet
  if (!positioning && walls.length === 0) {
    return (
      <Card className="bg-background/50 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="w-5 h-5" />
            Gamma Intelligence - {symbol}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <Activity className="w-4 h-4" />
            <AlertDescription>
              Waiting for Python to publish gamma data...
              <br />
              <span className="text-xs text-muted-foreground">
                Run: python -c "from engine.data.publisher import publish_gamma; ..."
              </span>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-background/50 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-lg">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Gamma Intelligence - {symbol}
          </div>
          {renderPositioningBadge()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Positioning Summary */}
        {positioning && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Net GEX</span>
              <div
                className={cn(
                  'text-xl font-mono font-bold',
                  positioning.net_gamma > 0 ? 'text-green-400' : 'text-red-400'
                )}
              >
                ${formatGamma(positioning.net_gamma)}
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Strength</span>
              <div className="flex items-center gap-2">
                <Progress value={positioning.positioning_strength} className="flex-1 h-3" />
                <span className="text-sm font-mono">
                  {positioning.positioning_strength.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Spot</span>
              <div className="text-lg font-mono">${positioning.spot_price.toFixed(2)}</div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Zero Gamma</span>
              <div className="text-lg font-mono">
                {positioning.zero_gamma_level
                  ? `$${positioning.zero_gamma_level.toFixed(2)}`
                  : '-'}
              </div>
            </div>
          </div>
        )}

        {/* Vol Impact */}
        {positioning && renderVolImpact()}

        {/* Gamma Walls */}
        {walls.length > 0 && (
          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Gamma Walls</span>
            <div className="space-y-2">{walls.map(renderWall)}</div>
          </div>
        )}

        {/* Regime Summary */}
        {regime && (
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Market Regime</span>
              <Badge
                variant="outline"
                className={cn(
                  regime.vix_regime === 'OPTIMAL' && 'border-green-500 text-green-400',
                  regime.vix_regime === 'SUBOPTIMAL' && 'border-yellow-500 text-yellow-400',
                  regime.vix_regime === 'PAUSE' && 'border-red-500 text-red-400'
                )}
              >
                VIX {regime.vix_level.toFixed(1)} - {regime.vix_regime}
              </Badge>
            </div>
          </div>
        )}

        {/* Last Updated */}
        {positioning && (
          <div className="text-xs text-muted-foreground text-right">
            Updated: {new Date(positioning.updated_at).toLocaleTimeString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const GammaIntelligenceMonitor = memo(GammaIntelligenceMonitorComponent);
export default GammaIntelligenceMonitor;
