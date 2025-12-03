/**
 * Chat Sidebar - Collapsible session history panel
 */

import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar';
import { ChatSessionList } from './ChatSessionList';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { supabase } from '@/integrations/supabase/client';
import { useChatContext } from '@/contexts/ChatContext';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function ChatSidebar() {
  const { state } = useSidebar();
  const { setSelectedSession } = useChatContext();
  const isCollapsed = state === 'collapsed';

  const createNewSession = async () => {
    try {
      console.log('[ChatSidebar] Creating new session...');

      // First, get or create a workspace
      let workspaceId: string;

      const { data: workspaces, error: wsError } = await supabase
        .from('workspaces')
        .select('id')
        .limit(1);

      if (wsError) {
        console.error('[ChatSidebar] Workspace query error:', wsError);
        throw wsError;
      }

      if (workspaces && workspaces.length > 0) {
        workspaceId = workspaces[0].id;
      } else {
        const { data: newWs, error: createWsError } = await supabase
          .from('workspaces')
          .insert({ name: 'Default Workspace' })
          .select()
          .single();

        if (createWsError) {
          console.error('[ChatSidebar] Workspace creation error:', createWsError);
          throw createWsError;
        }

        workspaceId = newWs.id;
      }

      // Create session
      const { data, error } = await supabase
        .from('chat_sessions')
        .insert({
          title: `Chat ${new Date().toLocaleString()}`,
          workspace_id: workspaceId,
        })
        .select()
        .single();

      if (error) {
        console.error('[ChatSidebar] Session creation error:', error);
        throw error;
      }

      console.log('[ChatSidebar] Session created:', data.id);
      setSelectedSession(data.id, data.workspace_id);
      toast.success('New chat session created');
      
      // Trigger a refresh of the session list
      window.dispatchEvent(new CustomEvent('refresh-chat-sessions'));

    } catch (error: any) {
      console.error('[ChatSidebar] Error creating session:', error);
      toast.error(`Failed to create session: ${error.message || 'Unknown error'}`);
    }
  };

  return (
    <Sidebar 
      collapsible="icon" 
      className="border-r border-border bg-card !top-[calc(52px+32px)] !h-[calc(100svh-52px-32px)]"
      style={{
        '--sidebar-width': '280px',
        '--sidebar-width-icon': '0px',
      } as React.CSSProperties}
    >
      <SidebarHeader className="border-b border-border p-3 bg-muted/50 shrink-0">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                onClick={createNewSession}
                variant="default"
                size={isCollapsed ? "icon" : "default"}
                className="w-full gap-2 h-9"
              >
                <Plus className="h-4 w-4" />
                {!isCollapsed && <span>New Chat</span>}
              </Button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">
                <p>New Chat</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </SidebarHeader>
      <SidebarContent>
        <ChatSessionList />
      </SidebarContent>
    </Sidebar>
  );
}
