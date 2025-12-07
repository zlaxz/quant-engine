/**
 * AppHeader - Consistent navigation header across all pages
 *
 * Features:
 * - Breadcrumb navigation
 * - Quick page links
 * - System status indicators
 * - Keyboard shortcut hints
 */

import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home,
  Activity,
  BarChart3,
  Layers,
  Settings,
  Wifi,
  WifiOff,
  Command,
  ChevronRight,
  Cpu,
  Clock,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useJarvisEvents } from '@/hooks/useJarvisEvents';
import { useState, useEffect } from 'react';

interface NavItem {
  path: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Home', shortLabel: 'Home', icon: Home, shortcut: '1' },
  { path: '/terminal', label: 'Trading Terminal', shortLabel: 'Terminal', icon: Activity, shortcut: '2' },
  { path: '/strategies', label: 'Strategy Library', shortLabel: 'Strategies', icon: Layers, shortcut: '3' },
  { path: '/dashboard', label: 'Dashboard', shortLabel: 'Dashboard', icon: BarChart3, shortcut: '4' },
  { path: '/settings', label: 'Settings', shortLabel: 'Settings', icon: Settings, shortcut: '5' },
];

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  showBreadcrumb?: boolean;
  showNav?: boolean;
  actions?: React.ReactNode;
  className?: string;
}

export function AppHeader({
  title,
  subtitle,
  showBreadcrumb = true,
  showNav = true,
  actions,
  className,
}: AppHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isConnected } = useJarvisEvents();
  const [time, setTime] = useState(new Date());

  // Update clock
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Get current nav item
  const currentNav = NAV_ITEMS.find(item => {
    if (item.path === '/') return location.pathname === '/';
    return location.pathname.startsWith(item.path);
  });

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger with Cmd/Ctrl modifier
      if (!e.metaKey && !e.ctrlKey) return;

      const num = parseInt(e.key);
      if (num >= 1 && num <= NAV_ITEMS.length) {
        e.preventDefault();
        navigate(NAV_ITEMS[num - 1].path);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  return (
    <header className={cn(
      "flex items-center justify-between px-4 py-2 border-b bg-card/50 backdrop-blur sticky top-0 z-50",
      className
    )}>
      {/* Left: Logo + Breadcrumb/Title */}
      <div className="flex items-center gap-4">
        {/* Logo */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="relative">
            <Cpu className="h-5 w-5 text-primary" />
            <div className={cn(
              "absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full",
              isConnected ? "bg-green-500" : "bg-red-500"
            )} />
          </div>
          <span className="font-semibold text-sm hidden sm:block">MPE</span>
        </button>

        {/* Breadcrumb */}
        {showBreadcrumb && currentNav && location.pathname !== '/' && (
          <div className="flex items-center gap-1 text-sm">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-1.5">
              <currentNav.icon className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{title || currentNav.label}</span>
            </div>
          </div>
        )}

        {/* Custom title when on home */}
        {location.pathname === '/' && title && (
          <div className="flex items-center gap-1 text-sm">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{title}</span>
          </div>
        )}

        {/* Subtitle */}
        {subtitle && (
          <span className="text-xs text-muted-foreground hidden md:block">
            {subtitle}
          </span>
        )}
      </div>

      {/* Center: Navigation */}
      {showNav && (
        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map(item => (
            <Button
              key={item.path}
              variant={location.pathname === item.path ||
                (item.path !== '/' && location.pathname.startsWith(item.path))
                  ? 'secondary'
                  : 'ghost'
              }
              size="sm"
              className="h-8 px-3 gap-1.5"
              onClick={() => navigate(item.path)}
            >
              <item.icon className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{item.shortLabel}</span>
              <kbd className="hidden xl:inline ml-1 text-[9px] font-mono text-muted-foreground bg-muted px-1 rounded">
                {item.shortcut}
              </kbd>
            </Button>
          ))}
        </nav>
      )}

      {/* Mobile: Dropdown nav */}
      {showNav && (
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                {currentNav && <currentNav.icon className="h-4 w-4" />}
                <span>{currentNav?.shortLabel || 'Menu'}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-48">
              {NAV_ITEMS.map(item => (
                <DropdownMenuItem
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className="gap-2"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Right: Status + Actions */}
      <div className="flex items-center gap-3">
        {/* Custom actions */}
        {actions}

        {/* Connection status */}
        <Badge
          variant={isConnected ? 'outline' : 'destructive'}
          className={cn(
            "gap-1 text-[10px]",
            isConnected && "bg-green-500/10 text-green-500 border-green-500/30"
          )}
        >
          {isConnected ? (
            <>
              <Wifi className="w-3 h-3" />
              <span className="hidden sm:inline">Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3" />
              <span className="hidden sm:inline">Offline</span>
            </>
          )}
        </Badge>

        {/* Clock */}
        <div className="hidden sm:flex items-center gap-1 text-xs font-mono text-muted-foreground">
          <Clock className="w-3 h-3" />
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>

        {/* Keyboard hint */}
        <kbd className="hidden lg:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground bg-muted rounded border">
          <Command className="h-2.5 w-2.5" />K
        </kbd>
      </div>
    </header>
  );
}

export default AppHeader;
