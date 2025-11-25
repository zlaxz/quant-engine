/**
 * Command Palette (Cmd+K) - Zero-Friction Interface
 *
 * ADHD-optimized command palette using cmdk.
 * No slash commands, no memorization - just Cmd+K and pick.
 *
 * Created: 2025-11-24
 */

import { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import {
  Square,
  Activity,
  FileText,
  Settings,
  Zap,
  Moon,
  AlertTriangle,
  RefreshCw,
  LayoutDashboard,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface CommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void | Promise<void>;
  category: 'daemon' | 'navigation' | 'system' | 'danger';
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const navigate = useNavigate();

  // Global keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = useCallback(async (item: CommandItem) => {
    setLoading(item.id);
    try {
      await item.action();
    } catch (error) {
      toast.error(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(null);
      setOpen(false);
    }
  }, []);

  const commands: CommandItem[] = [
    // Daemon Controls
    {
      id: 'start-night-shift',
      label: 'Start Night Shift',
      description: 'Launch the autonomous research daemon',
      icon: <Moon className="h-4 w-4" />,
      category: 'daemon',
      action: async () => {
        if (!window.electron?.startDaemon) {
          toast.error('Electron not available');
          return;
        }
        const result = await window.electron.startDaemon();
        if (result.success) {
          toast.success('Night Shift started', {
            description: `PID: ${result.pid}`,
          });
        } else {
          toast.error('Failed to start Night Shift', {
            description: result.error,
          });
        }
      },
    },
    {
      id: 'stop-night-shift',
      label: 'Stop Night Shift',
      description: 'Gracefully stop the research daemon',
      icon: <Square className="h-4 w-4" />,
      category: 'daemon',
      action: async () => {
        if (!window.electron?.stopDaemon) {
          toast.error('Electron not available');
          return;
        }
        const result = await window.electron.stopDaemon();
        if (result.success) {
          toast.success('Night Shift stopped');
        } else {
          toast.error('Failed to stop', { description: result.error });
        }
      },
    },
    {
      id: 'restart-daemon',
      label: 'Restart Night Shift',
      description: 'Stop and restart the daemon',
      icon: <RefreshCw className="h-4 w-4" />,
      category: 'daemon',
      action: async () => {
        if (!window.electron?.restartDaemon) {
          toast.error('Electron not available');
          return;
        }
        toast.info('Restarting Night Shift...');
        const result = await window.electron.restartDaemon();
        if (result.success) {
          toast.success('Night Shift restarted', { description: `PID: ${result.pid}` });
        } else {
          toast.error('Restart failed', { description: result.error });
        }
      },
    },

    // System
    {
      id: 'check-health',
      label: 'Check System Health',
      description: 'Verify daemon, drive, and API status',
      icon: <Activity className="h-4 w-4" />,
      category: 'system',
      action: async () => {
        if (!window.electron?.getSystemHealth) {
          toast.error('Electron not available');
          return;
        }
        const health = await window.electron.getSystemHealth();
        const issues: string[] = [];
        if (!health.daemon) issues.push('Daemon offline');
        if (!health.dataDrive) issues.push('VelocityData not mounted');
        if (!health.api) issues.push('API key missing');

        if (issues.length === 0) {
          toast.success('All systems operational', {
            description: 'Daemon, drive, and API are healthy',
          });
        } else {
          toast.warning('Issues detected', {
            description: issues.join(', '),
          });
        }
      },
    },
    {
      id: 'view-briefing',
      label: 'View Morning Briefing',
      description: 'Open the latest strategy briefing',
      icon: <FileText className="h-4 w-4" />,
      category: 'system',
      action: () => {
        navigate('/dashboard');
        toast.info('Opening Dashboard');
      },
    },

    // Navigation
    {
      id: 'go-dashboard',
      label: 'Go to Dashboard',
      description: "Open the Conductor's Dashboard",
      icon: <LayoutDashboard className="h-4 w-4" />,
      shortcut: 'D',
      category: 'navigation',
      action: () => navigate('/dashboard'),
    },
    {
      id: 'go-settings',
      label: 'Go to Settings',
      description: 'Configure API keys and paths',
      icon: <Settings className="h-4 w-4" />,
      shortcut: ',',
      category: 'navigation',
      action: () => navigate('/settings'),
    },
    {
      id: 'go-chat',
      label: 'Go to Chat',
      description: 'Return to Chief Quant chat',
      icon: <Zap className="h-4 w-4" />,
      category: 'navigation',
      action: () => navigate('/'),
    },

    // Danger Zone
    {
      id: 'panic-stop',
      label: 'PANIC: Stop All Trading',
      description: 'Emergency stop - kills daemon and closes positions',
      icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
      category: 'danger',
      action: async () => {
        if (!window.electron?.panicStop) {
          toast.error('Electron not available');
          return;
        }
        toast.warning('PANIC STOP initiated...');
        const result = await window.electron.panicStop();
        if (result.success) {
          toast.error('All trading stopped', {
            description: 'Daemon killed. Review positions manually.',
          });
        }
      },
    },
  ];

  const daemonCommands = commands.filter((c) => c.category === 'daemon');
  const systemCommands = commands.filter((c) => c.category === 'system');
  const navCommands = commands.filter((c) => c.category === 'navigation');
  const dangerCommands = commands.filter((c) => c.category === 'danger');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 shadow-lg max-w-lg">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          <div className="flex items-center border-b px-3">
            <Zap className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Command.Input
              placeholder="Type a command or search..."
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No commands found.
            </Command.Empty>

            <Command.Group heading="Night Shift">
              {daemonCommands.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => runCommand(item)}
                  className="flex items-center gap-2 cursor-pointer aria-selected:bg-accent"
                >
                  {loading === item.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    item.icon
                  )}
                  <div className="flex-1">
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                  {item.shortcut && (
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                      <span className="text-xs">⌘</span>{item.shortcut}
                    </kbd>
                  )}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="System">
              {systemCommands.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => runCommand(item)}
                  className="flex items-center gap-2 cursor-pointer aria-selected:bg-accent"
                >
                  {loading === item.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    item.icon
                  )}
                  <div className="flex-1">
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Navigation">
              {navCommands.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => runCommand(item)}
                  className="flex items-center gap-2 cursor-pointer aria-selected:bg-accent"
                >
                  {item.icon}
                  <div className="flex-1">
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                  {item.shortcut && (
                    <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                      <span className="text-xs">⌘</span>{item.shortcut}
                    </kbd>
                  )}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Danger Zone">
              {dangerCommands.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => runCommand(item)}
                  className="flex items-center gap-2 cursor-pointer aria-selected:bg-red-500/10"
                >
                  {loading === item.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-red-500" />
                  ) : (
                    item.icon
                  )}
                  <div className="flex-1">
                    <div className="text-sm font-medium text-red-500">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>

          <div className="border-t px-3 py-2 text-xs text-muted-foreground">
            Press <kbd className="rounded bg-muted px-1">⌘K</kbd> to open,{' '}
            <kbd className="rounded bg-muted px-1">↑↓</kbd> to navigate,{' '}
            <kbd className="rounded bg-muted px-1">↵</kbd> to select
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
