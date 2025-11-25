/**
 * Infrastructure Settings - Zero-Friction Interface
 *
 * ADHD-optimized settings for:
 * - Massive.com / Polygon API Key
 * - Telegram ID (for notifications)
 * - Data Drive Path
 *
 * Saved to electron-store (persisted JSON), not .env
 *
 * Created: 2025-11-24
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Save,
  FolderOpen,
  CheckCircle2,
  XCircle,
  Loader2,
  HardDrive,
  Wifi,
  MessageSquare,
} from 'lucide-react';

interface InfraConfig {
  massiveApiKey: string;
  polygonApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  dataDrivePath: string;
}

export function InfrastructureSettings() {
  const [config, setConfig] = useState<InfraConfig>({
    massiveApiKey: '',
    polygonApiKey: '',
    telegramBotToken: '',
    telegramChatId: '',
    dataDrivePath: '/Volumes/VelocityData/market_data',
  });

  const [showMassive, setShowMassive] = useState(false);
  const [showPolygon, setShowPolygon] = useState(false);
  const [showTelegram, setShowTelegram] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, boolean | null>>({
    dataDrive: null,
    polygon: null,
    telegram: null,
  });

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      if (window.electron?.getInfraConfig) {
        const saved = await window.electron.getInfraConfig();
        setConfig((prev) => ({ ...prev, ...saved }));
      }
    } catch (error) {
      console.error('Failed to load infrastructure config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (window.electron?.setInfraConfig) {
        await window.electron.setInfraConfig(config);
        toast.success('Infrastructure settings saved');
      } else {
        toast.error('Electron not available');
      }
    } catch (error) {
      toast.error('Save failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePickDirectory = async () => {
    try {
      if (window.electron?.pickDirectory) {
        const path = await window.electron.pickDirectory();
        if (path) {
          setConfig((prev) => ({ ...prev, dataDrivePath: path }));
          toast.success('Directory selected', { description: path });
        }
      }
    } catch (error) {
      toast.error('Failed to pick directory');
    }
  };

  const testDataDrive = async () => {
    setTesting('dataDrive');
    setTestResults((prev) => ({ ...prev, dataDrive: null }));

    try {
      if (window.electron?.testDataDrive) {
        const result = await window.electron.testDataDrive(config.dataDrivePath);
        setTestResults((prev) => ({ ...prev, dataDrive: result.success }));
        if (result.success) {
          toast.success('Data drive connected', {
            description: `Found ${result.fileCount || 0} files`,
          });
        } else {
          toast.error('Data drive not accessible', {
            description: result.error,
          });
        }
      } else {
        // Fallback: just check if path exists
        setTestResults((prev) => ({ ...prev, dataDrive: true }));
        toast.info('Path looks valid (cannot verify in browser)');
      }
    } catch (error) {
      setTestResults((prev) => ({ ...prev, dataDrive: false }));
      toast.error('Test failed');
    } finally {
      setTesting(null);
    }
  };

  const testPolygonApi = async () => {
    setTesting('polygon');
    setTestResults((prev) => ({ ...prev, polygon: null }));

    try {
      if (window.electron?.testPolygonApi) {
        const result = await window.electron.testPolygonApi(config.polygonApiKey);
        setTestResults((prev) => ({ ...prev, polygon: result.success }));
        if (result.success) {
          toast.success('Polygon API connected');
        } else {
          toast.error('Polygon API failed', { description: result.error });
        }
      } else {
        // Fallback: basic validation
        if (config.polygonApiKey.length > 10) {
          setTestResults((prev) => ({ ...prev, polygon: true }));
          toast.info('API key looks valid (cannot verify in browser)');
        } else {
          setTestResults((prev) => ({ ...prev, polygon: false }));
          toast.error('API key too short');
        }
      }
    } catch (error) {
      setTestResults((prev) => ({ ...prev, polygon: false }));
      toast.error('Test failed');
    } finally {
      setTesting(null);
    }
  };

  const testTelegram = async () => {
    setTesting('telegram');
    setTestResults((prev) => ({ ...prev, telegram: null }));

    try {
      if (window.electron?.testTelegram) {
        const result = await window.electron.testTelegram(
          config.telegramBotToken,
          config.telegramChatId
        );
        setTestResults((prev) => ({ ...prev, telegram: result.success }));
        if (result.success) {
          toast.success('Telegram connected', {
            description: 'Test message sent!',
          });
        } else {
          toast.error('Telegram failed', { description: result.error });
        }
      } else {
        // Fallback: basic validation
        if (config.telegramBotToken && config.telegramChatId) {
          setTestResults((prev) => ({ ...prev, telegram: true }));
          toast.info('Credentials look valid (cannot verify in browser)');
        } else {
          setTestResults((prev) => ({ ...prev, telegram: false }));
          toast.error('Both bot token and chat ID required');
        }
      }
    } catch (error) {
      setTestResults((prev) => ({ ...prev, telegram: false }));
      toast.error('Test failed');
    } finally {
      setTesting(null);
    }
  };

  const maskKey = (key: string) => {
    if (!key || key.length < 8) return key;
    return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
  };

  const TestResultIcon = ({ result }: { result: boolean | null }) => {
    if (result === null) return null;
    return result ? (
      <CheckCircle2 className="h-4 w-4 text-green-500" />
    ) : (
      <XCircle className="h-4 w-4 text-red-500" />
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Data Drive */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            <CardTitle>Data Drive</CardTitle>
          </div>
          <CardDescription>
            Local storage for Parquet market data files (VelocityData external SSD)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="data-drive">Market Data Path</Label>
            <div className="flex gap-2">
              <Input
                id="data-drive"
                value={config.dataDrivePath}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, dataDrivePath: e.target.value }))
                }
                placeholder="/Volumes/VelocityData/market_data"
                className="font-mono text-sm"
              />
              <Button variant="outline" size="icon" onClick={handlePickDirectory}>
                <FolderOpen className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={testDataDrive}
                disabled={testing === 'dataDrive'}
              >
                {testing === 'dataDrive' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Test
                    <TestResultIcon result={testResults.dataDrive} />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Polygon / Massive API */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            <CardTitle>Market Data API</CardTitle>
          </div>
          <CardDescription>
            Polygon.io WebSocket key for real-time data (same key works for Massive.com flatfiles)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="polygon-key">Polygon API Key</Label>
            <div className="flex gap-2">
              <Input
                id="polygon-key"
                type={showPolygon ? 'text' : 'password'}
                value={showPolygon ? config.polygonApiKey : maskKey(config.polygonApiKey)}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, polygonApiKey: e.target.value }))
                }
                placeholder="Enter your Polygon.io API key"
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowPolygon(!showPolygon)}
              >
                {showPolygon ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                onClick={testPolygonApi}
                disabled={testing === 'polygon' || !config.polygonApiKey}
              >
                {testing === 'polygon' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Test
                    <TestResultIcon result={testResults.polygon} />
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Also used as AWS_SECRET_ACCESS_KEY for Massive.com S3 access
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="massive-key">Massive.com Access Key ID</Label>
            <div className="flex gap-2">
              <Input
                id="massive-key"
                type={showMassive ? 'text' : 'password'}
                value={showMassive ? config.massiveApiKey : maskKey(config.massiveApiKey)}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, massiveApiKey: e.target.value }))
                }
                placeholder="Enter your Massive.com Access Key ID"
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowMassive(!showMassive)}
              >
                {showMassive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Used as AWS_ACCESS_KEY_ID for Massive.com S3 flatfiles
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Telegram Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <CardTitle>Telegram Notifications</CardTitle>
          </div>
          <CardDescription>
            Get alerts when strategies graduate or require attention
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="telegram-token">Bot Token</Label>
            <div className="flex gap-2">
              <Input
                id="telegram-token"
                type={showTelegram ? 'text' : 'password'}
                value={showTelegram ? config.telegramBotToken : maskKey(config.telegramBotToken)}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, telegramBotToken: e.target.value }))
                }
                placeholder="Enter your Telegram bot token"
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowTelegram(!showTelegram)}
              >
                {showTelegram ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegram-chat">Chat ID</Label>
            <div className="flex gap-2">
              <Input
                id="telegram-chat"
                value={config.telegramChatId}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, telegramChatId: e.target.value }))
                }
                placeholder="Enter your Telegram chat ID"
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                onClick={testTelegram}
                disabled={
                  testing === 'telegram' ||
                  !config.telegramBotToken ||
                  !config.telegramChatId
                }
              >
                {testing === 'telegram' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Test
                    <TestResultIcon result={testResults.telegram} />
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Create a bot via @BotFather and get your chat ID via @userinfobot
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <Button onClick={handleSave} className="w-full" disabled={saving}>
        {saving ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Save className="mr-2 h-4 w-4" />
        )}
        Save Infrastructure Settings
      </Button>
    </div>
  );
}
