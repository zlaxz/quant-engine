/**
 * ConversationTimeline - Enhanced collapsible timeline showing research journey
 * 
 * Features:
 * - Chronological activity log
 * - Stage markers
 * - Tool executions
 * - Findings highlights
 * - Collapsible sections
 * - Color-coded by stage
 */

import { ChevronDown, MessageSquare, Wrench, Lightbulb, Target, Database } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface TimelineEvent {
  id: string;
  type: 'message' | 'tool' | 'stage' | 'finding' | 'task';
  title: string;
  description?: string;
  timestamp: number;
  stage?: string;
  metadata?: Record<string, any>;
}

interface ConversationTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

const EVENT_ICONS = {
  message: MessageSquare,
  tool: Wrench,
  stage: Target,
  finding: Lightbulb,
  task: Database,
};

const EVENT_COLORS = {
  message: 'text-blue-500',
  tool: 'text-purple-500',
  stage: 'text-green-500',
  finding: 'text-yellow-500',
  task: 'text-orange-500',
};

export function ConversationTimeline({ events, className }: ConversationTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  if (events.length === 0) return null;

  const displayEvents = showAll ? events : events.slice(-10);
  const hasMore = events.length > 10;

  return (
    <div className={cn('rounded-lg border bg-card', className)}>
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Research Timeline</h3>
          <Badge variant="secondary" className="text-xs">
            {events.length} events
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-7 w-7 p-0"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform',
              isExpanded && 'rotate-180'
            )}
          />
        </Button>
      </div>

      {/* Timeline */}
      {isExpanded && (
        <ScrollArea className="h-96 p-3">
          <div className="space-y-3 relative">
            {/* Vertical line */}
            <div className="absolute left-[11px] top-0 bottom-0 w-px bg-border" />

            {displayEvents.map((event) => {
              const Icon = EVENT_ICONS[event.type];
              const colorClass = EVENT_COLORS[event.type];

              return (
                <div key={event.id} className="relative pl-8">
                  {/* Icon */}
                  <div
                    className={cn(
                      'absolute left-0 top-1 w-6 h-6 rounded-full bg-background border-2 flex items-center justify-center',
                      colorClass
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </div>

                  {/* Content */}
                  <div className="pb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">{event.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    {event.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {event.description}
                      </p>
                    )}

                    {event.stage && (
                      <Badge variant="outline" className="text-xs h-4 mt-1">
                        {event.stage}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}

            {hasMore && !showAll && (
              <div className="relative pl-8">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAll(true)}
                  className="h-7 text-xs"
                >
                  Show {events.length - 10} earlier events
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
