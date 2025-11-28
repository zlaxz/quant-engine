/**
 * Chat Sidebar - Collapsible session history panel
 * Collapses to a thin sliver (56px) showing only icons
 */

import { Sidebar, SidebarContent, SidebarHeader, useSidebar } from '@/components/ui/sidebar';
import { ChatSessionList } from './ChatSessionList';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ChatSidebar() {
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';

  return (
    <Sidebar 
      collapsible="icon" 
      className="border-r border-border bg-card"
      style={{
        '--sidebar-width': '280px',
        '--sidebar-width-icon': '18px',
      } as React.CSSProperties}
    >
      <SidebarHeader className={cn(
        "border-b border-border flex flex-row items-center",
        isCollapsed ? "justify-center p-2" : "justify-between p-3"
      )}>
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Chat Sessions</span>
          </div>
        )}
      </SidebarHeader>
      
      <SidebarContent>
        <ChatSessionList />
      </SidebarContent>
    </Sidebar>
  );
}
