/**
 * Launchpad - Simple Two-Path Entry Point
 *
 * ADHD Design: Two choices, that's it.
 * - TRADING: Live positions, execution, real money
 * - DISCOVERY: Research, backtesting, experimentation
 *
 * No gamification. No achievements. No XP bars.
 * Just get to work.
 */

import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Eye,
  TrendingUp,
  Search,
  ChevronRight,
  DollarSign,
  FlaskConical,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ============================================================================
// Two Paths - That's It
// ============================================================================

interface PathOption {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  route: string;
  gradient: string;
  details: string[];
}

const PATHS: PathOption[] = [
  {
    id: 'trading',
    name: 'Trading',
    description: 'Live positions, execution, real money',
    icon: DollarSign,
    route: '/terminal',
    gradient: 'from-green-500 to-emerald-600',
    details: [
      'View and manage positions',
      'Execute trades',
      'Monitor P&L in real-time',
      'Access kill switch',
    ],
  },
  {
    id: 'discovery',
    name: 'Discovery',
    description: 'Research, backtesting, strategy development',
    icon: FlaskConical,
    route: '/observatory',
    gradient: 'from-blue-500 to-cyan-600',
    details: [
      'Run factor discovery',
      'Execute backtests',
      'Monitor pipeline activity',
      'Review strategy performance',
    ],
  },
];

// ============================================================================
// Path Card
// ============================================================================

function PathCard({ path, onClick }: { path: PathOption; onClick: () => void }) {
  return (
    <Card
      className={cn(
        "group relative overflow-hidden cursor-pointer transition-all duration-300",
        "hover:scale-[1.02] hover:shadow-2xl",
        "bg-card border-2 hover:border-primary/50",
        "min-h-[300px] flex flex-col"
      )}
      onClick={onClick}
    >
      {/* Gradient background on hover */}
      <div className={cn(
        "absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300",
        `bg-gradient-to-br ${path.gradient}`
      )} />

      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className={cn(
            "p-4 rounded-2xl bg-gradient-to-br shadow-lg",
            path.gradient
          )}>
            <path.icon className="h-10 w-10 text-white" />
          </div>
          <ChevronRight className="h-6 w-6 text-muted-foreground group-hover:translate-x-2 group-hover:text-primary transition-all" />
        </div>
        <CardTitle className="text-3xl mt-6">{path.name}</CardTitle>
        <CardDescription className="text-base">{path.description}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        <ul className="space-y-2">
          {path.details.map((detail, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                path.id === 'trading' ? 'bg-green-500' : 'bg-blue-500'
              )} />
              {detail}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function Launchpad() {
  const navigate = useNavigate();

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-8">
      {/* Simple Header */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-2">What are you doing?</h1>
        <p className="text-lg text-muted-foreground">Pick one. Get to work.</p>
      </div>

      {/* Two Choices */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
        {PATHS.map(path => (
          <PathCard
            key={path.id}
            path={path}
            onClick={() => navigate(path.route)}
          />
        ))}
      </div>

      {/* Minimal Footer */}
      <div className="mt-12 text-center text-sm text-muted-foreground">
        <p>Press <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Cmd+K</kbd> for quick commands</p>
      </div>
    </div>
  );
}
