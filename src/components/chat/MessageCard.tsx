/**
 * MessageCard - Kanban-style card for chat messages
 * 
 * Provides clear visual boundaries and organization for conversation thread
 */

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, Bot, Terminal, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface MessageCardProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  className?: string;
}

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
        label: 'Chief Quant',
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

export function MessageCard({ role, content, timestamp, className }: MessageCardProps) {
  const config = getRoleConfig(role);
  const Icon = config.icon;

  return (
    <Card className={cn(
      'p-4 mb-3 border-l-4 shadow-sm hover:shadow-md transition-all duration-200 animate-fade-in',
      config.borderColor,
      config.bgColor,
      className
    )}>
      {/* Header with role badge and timestamp */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
        <Badge className={cn('flex items-center gap-1.5', config.badgeColor)}>
          <Icon className="h-3.5 w-3.5" />
          <span className="font-semibold">{config.label}</span>
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
}