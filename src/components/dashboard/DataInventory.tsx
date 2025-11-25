/**
 * Data Inventory Panel - VelocityData coverage and gaps
 *
 * Shows:
 * - Available data by symbol/type
 * - Date range coverage
 * - Data gaps and staleness
 * - Disk usage statistics
 *
 * Created: 2025-11-24
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Database,
  HardDrive,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Search,
  RefreshCw,
  Loader2,
  FileWarning,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeFormat, safeDifferenceInDays } from '@/lib/dateUtils';

interface DataAsset {
  symbol: string;
  dataType: 'options' | 'equity' | 'futures' | 'index';
  startDate: string;
  endDate: string;
  totalDays: number;
  gapDays: number;
  sizeGB: number;
  lastUpdated: string;
  status: 'current' | 'stale' | 'gaps' | 'missing';
}

interface DiskStats {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  path: string;
  mounted: boolean;
}

const dataTypeColors: Record<string, string> = {
  options: 'bg-purple-500/10 text-purple-500',
  equity: 'bg-blue-500/10 text-blue-500',
  futures: 'bg-orange-500/10 text-orange-500',
  index: 'bg-green-500/10 text-green-500',
};

const statusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  current: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: 'text-green-500',
    label: 'Current',
  },
  stale: {
    icon: <Clock className="h-3 w-3" />,
    color: 'text-yellow-500',
    label: 'Stale',
  },
  gaps: {
    icon: <FileWarning className="h-3 w-3" />,
    color: 'text-orange-500',
    label: 'Has Gaps',
  },
  missing: {
    icon: <AlertTriangle className="h-3 w-3" />,
    color: 'text-red-500',
    label: 'Missing',
  },
};

export function DataInventory() {
  const [assets, setAssets] = useState<DataAsset[]>([]);
  const [diskStats, setDiskStats] = useState<DiskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchInventory = useCallback(async () => {
    try {
      setLoading(true);

      // Check if running in Electron
      if (window.electron && 'getDataInventory' in window.electron) {
        const inventory = await (window.electron as any).getDataInventory();
        setAssets(inventory.assets || []);
        setDiskStats(inventory.disk || null);
        setError(null);
      } else {
        // Mock data for development/browser mode
        const mockAssets: DataAsset[] = [
          {
            symbol: 'SPY',
            dataType: 'options',
            startDate: '2020-01-01',
            endDate: '2024-11-22',
            totalDays: 1230,
            gapDays: 0,
            sizeGB: 245.3,
            lastUpdated: new Date().toISOString(),
            status: 'current',
          },
          {
            symbol: 'SPX',
            dataType: 'index',
            startDate: '2018-01-01',
            endDate: '2024-11-22',
            totalDays: 1740,
            gapDays: 3,
            sizeGB: 89.2,
            lastUpdated: new Date().toISOString(),
            status: 'gaps',
          },
          {
            symbol: 'QQQ',
            dataType: 'options',
            startDate: '2020-06-01',
            endDate: '2024-11-20',
            totalDays: 1135,
            gapDays: 0,
            sizeGB: 178.4,
            lastUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
            status: 'stale',
          },
          {
            symbol: 'VIX',
            dataType: 'index',
            startDate: '2015-01-01',
            endDate: '2024-11-22',
            totalDays: 2480,
            gapDays: 0,
            sizeGB: 12.1,
            lastUpdated: new Date().toISOString(),
            status: 'current',
          },
          {
            symbol: '/ES',
            dataType: 'futures',
            startDate: '2019-01-01',
            endDate: '2024-11-22',
            totalDays: 1490,
            gapDays: 0,
            sizeGB: 156.7,
            lastUpdated: new Date().toISOString(),
            status: 'current',
          },
        ];

        const mockDisk: DiskStats = {
          totalGB: 8000,
          usedGB: 682,
          freeGB: 7318,
          path: '/Volumes/VelocityData',
          mounted: true,
        };

        setAssets(mockAssets);
        setDiskStats(mockDisk);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to fetch data inventory:', err);
      setError(err instanceof Error ? err.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const filteredAssets = assets.filter(
    (asset) =>
      asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.dataType.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDateRange = (start: string, end: string) => {
    return `${safeFormat(start, 'MMM yyyy', 'Unknown')} - ${safeFormat(end, 'MMM yyyy', 'Unknown')}`;
  };

  const getStaleDays = (lastUpdated: string) => {
    return safeDifferenceInDays(new Date(), lastUpdated, 0);
  };

  const totalDataGB = assets.reduce((sum, a) => sum + a.sizeGB, 0);
  const assetsWithGaps = assets.filter((a) => a.gapDays > 0).length;
  const staleAssets = assets.filter((a) => a.status === 'stale').length;

  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4" />
            Data Inventory
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchInventory}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0 flex flex-col">
        {/* Disk Stats */}
        {diskStats && (
          <div className="px-4 pb-3 border-b">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive
                className={cn(
                  'h-4 w-4',
                  diskStats.mounted ? 'text-green-500' : 'text-red-500'
                )}
              />
              <span className="text-sm font-medium">
                {diskStats.path}
              </span>
              {!diskStats.mounted && (
                <Badge variant="destructive" className="text-xs">
                  Not Mounted
                </Badge>
              )}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{diskStats.usedGB.toFixed(0)} GB used</span>
                <span>{diskStats.freeGB.toFixed(0)} GB free</span>
              </div>
              <Progress
                value={(diskStats.usedGB / diskStats.totalGB) * 100}
                className="h-1.5"
              />
            </div>
          </div>
        )}

        {/* Summary Stats */}
        <div className="px-4 py-2 grid grid-cols-3 gap-2 border-b text-center">
          <div>
            <div className="text-lg font-semibold">{assets.length}</div>
            <div className="text-xs text-muted-foreground">Symbols</div>
          </div>
          <div>
            <div className="text-lg font-semibold">{totalDataGB.toFixed(0)}</div>
            <div className="text-xs text-muted-foreground">GB Total</div>
          </div>
          <div>
            <div className={cn('text-lg font-semibold', assetsWithGaps > 0 && 'text-orange-500')}>
              {assetsWithGaps}
            </div>
            <div className="text-xs text-muted-foreground">With Gaps</div>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbols..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>

        {/* Asset List */}
        <ScrollArea className="flex-1">
          <div className="px-4 pb-4 space-y-2">
            {error ? (
              <div className="text-center py-4 text-red-500 text-sm">{error}</div>
            ) : filteredAssets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {searchQuery ? 'No matching symbols' : 'No data inventory available'}
              </div>
            ) : (
              filteredAssets.map((asset) => {
                const status = statusConfig[asset.status];
                const staleDays = getStaleDays(asset.lastUpdated);

                return (
                  <div
                    key={`${asset.symbol}-${asset.dataType}`}
                    className="p-3 rounded-lg bg-muted/50 space-y-2"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{asset.symbol}</span>
                        <Badge
                          variant="secondary"
                          className={cn('text-xs', dataTypeColors[asset.dataType])}
                        >
                          {asset.dataType}
                        </Badge>
                      </div>
                      <div className={cn('flex items-center gap-1 text-xs', status.color)}>
                        {status.icon}
                        <span>{status.label}</span>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {formatDateRange(asset.startDate, asset.endDate)}
                      </div>
                      <div className="text-right">
                        <span className="text-muted-foreground">Size: </span>
                        <span className="font-mono">{asset.sizeGB.toFixed(1)} GB</span>
                      </div>
                      <div className="text-muted-foreground">
                        {asset.totalDays.toLocaleString()} trading days
                      </div>
                      <div className="text-right">
                        {staleDays > 0 && (
                          <span className={cn(staleDays > 2 ? 'text-yellow-500' : 'text-muted-foreground')}>
                            {staleDays}d stale
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Gaps Warning */}
                    {asset.gapDays > 0 && (
                      <div className="flex items-center gap-1 text-xs text-orange-500 bg-orange-500/10 px-2 py-1 rounded">
                        <AlertTriangle className="h-3 w-3" />
                        {asset.gapDays} gap days detected
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
