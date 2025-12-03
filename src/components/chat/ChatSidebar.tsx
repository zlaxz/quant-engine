/**
 * Chat Sidebar - Collapsible session history panel
 */

import { Sidebar, SidebarContent } from '@/components/ui/sidebar';
import { ChatSessionList } from './ChatSessionList';

export function ChatSidebar() {
  return (
    <Sidebar 
      collapsible="icon" 
      className="border-r border-border bg-card"
      style={{
        '--sidebar-width': '260px',
        '--sidebar-width-icon': '48px',
      } as React.CSSProperties}
    >
      <SidebarContent>
        <ChatSessionList />
      </SidebarContent>
    </Sidebar>
  );
}
