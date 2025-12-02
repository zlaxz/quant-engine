/**
 * MessageCard - Kanban-style card for chat messages
 *
 * Provides clear visual boundaries and organization for conversation thread
 * Memoized to prevent re-rendering all messages on every parent update
 */

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, Bot, Terminal, Clock, Brain, Zap, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { memo } from 'react';

interface MessageCardProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  model?: 'gemini' | 'claude' | 'claude-code' | 'deepseek'; // Which model generated this response
  className?: string;
}

// Get display config based on model (for assistant messages)
function getModelDisplayConfig(model?: string) {
  switch (model) {
    case 'gemini':
      return {
        icon: Brain,
        role: 'CIO',
        model: 'Gemini',
        badgeColor: 'bg-emerald-500 text-white',
        borderColor: 'border-l-emerald-500',
        bgColor: 'bg-emerald-50/50 dark:bg-emerald-950/20',
      };
    case 'claude':
      return {
        icon: Zap,
        role: 'API',
        model: 'Claude',
        badgeColor: 'bg-orange-500 text-white',
        borderColor: 'border-l-orange-500',
        bgColor: 'bg-orange-50/50 dark:bg-orange-950/20',
      };
    case 'claude-code':
      return {
        icon: Terminal,
        role: 'CTO',
        model: 'Claude Code',
        badgeColor: 'bg-amber-600 text-white',
        borderColor: 'border-l-amber-600',
        bgColor: 'bg-amber-50/50 dark:bg-amber-950/20',
      };
    case 'deepseek':
      return {
        icon: Workflow,
        role: 'Analyst',
        model: 'DeepSeek',
        badgeColor: 'bg-cyan-500 text-white',
        borderColor: 'border-l-cyan-500',
        bgColor: 'bg-cyan-50/50 dark:bg-cyan-950/20',
      };
    default:
      return null; // Will fall back to role-based config
  }
}

// Get display config based on role (fallback for non-model messages)
function getRoleConfig(role: string) {
  switch (role) {
    case 'user':
      return {
        icon: User,
        label: 'You',
        borderColor: 'border-l-blue-500',
        bgColor: 'bg-blue-50/50 dark:bg-blue-950/20',
        badgeColor: 'bg-blue-500 text-white',
      };
    case 'assistant':
      return {
        icon: Bot,
        label: 'Assistant',
        borderColor: 'border-l-purple-500',
        bgColor: 'bg-purple-50/50 dark:bg-purple-950/20',
        badgeColor: 'bg-purple-500 text-white',
      };
    case 'system':
      return {
        icon: Terminal,
        label: 'System',
        borderColor: 'border-l-gray-500',
        bgColor: 'bg-gray-50/50 dark:bg-gray-950/20',
        badgeColor: 'bg-gray-500 text-white',
      };
    default:
      return {
        icon: Bot,
        label: 'Unknown',
        borderColor: 'border-l-gray-500',
        bgColor: 'bg-gray-50/50 dark:bg-gray-950/20',
        badgeColor: 'bg-gray-500 text-white',
      };
  }
}

export const MessageCard = memo(function MessageCard({ role, content, timestamp, model, className }: MessageCardProps) {
  const roleConfig = getRoleConfig(role);
  const modelConfig = getModelDisplayConfig(model);

  // For assistant messages with known model, use model config; otherwise use role config
  const displayConfig = (role === 'assistant' && modelConfig) ? {
    icon: modelConfig.icon,
    label: modelConfig.role,
    sublabel: modelConfig.model,
    badgeColor: modelConfig.badgeColor,
    borderColor: modelConfig.borderColor,
    bgColor: modelConfig.bgColor,
  } : {
    icon: roleConfig.icon,
    label: roleConfig.label,
    sublabel: null,
    badgeColor: roleConfig.badgeColor,
    borderColor: roleConfig.borderColor,
    bgColor: roleConfig.bgColor,
  };

  const Icon = displayConfig.icon;

  return (
    <Card className={cn(
      'p-4 mb-3 border-l-4 shadow-sm hover:shadow-md transition-all duration-200 animate-fade-in',
      displayConfig.borderColor,
      displayConfig.bgColor,
      className
    )}>
      {/* Header with single badge and timestamp */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
        <Badge
          className={cn('flex items-center gap-1.5', displayConfig.badgeColor)}
          aria-label={displayConfig.sublabel ? `${displayConfig.label} - ${displayConfig.sublabel}` : displayConfig.label}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-semibold">{displayConfig.label}</span>
          {displayConfig.sublabel && (
            <span className="text-xs opacity-80">• {displayConfig.sublabel}</span>
          )}
        </Badge>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <time dateTime={timestamp}>
            {format(new Date(timestamp), 'h:mm a')}
          </time>
        </div>
      </div>

      {/* Content */}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        {content.startsWith('Command:') ? (
          <code className="block p-2 bg-background/50 rounded border border-border text-sm font-mono">
            {content.replace('Command: ', '')}
          </code>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {content}
          </div>
        )}
      </div>
    </Card>
  );
});