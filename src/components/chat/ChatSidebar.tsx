/**
 * Chat Sidebar - Collapsible session history panel
 */

import { Sidebar, SidebarContent, SidebarHeader, SidebarTrigger } from '@/components/ui/sidebar';
import { ChatSessionList } from './ChatSessionList';
import { MessageSquare } from 'lucide-react';

export function ChatSidebar() {
  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="border-b border-border p-3 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Chats</span>
        </div>
        <SidebarTrigger />
      </SidebarHeader>
      
      <SidebarContent>
        <ChatSessionList />
      </SidebarContent>
    </Sidebar>
  );
}
