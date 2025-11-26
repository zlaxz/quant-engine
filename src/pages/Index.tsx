import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { MainLayout } from '@/components/layout/MainLayout';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { ChatSessionList } from '@/components/chat/ChatSessionList';
import { ChatArea } from '@/components/chat/ChatArea';
import { RightPanel } from '@/components/panels/RightPanel';
import { HelperChatDialog } from '@/components/chat/HelperChatDialog';
import { VisualizationContainer } from '@/components/visualizations/VisualizationContainer';
import { Button } from '@/components/ui/button';
import { HelpCircle, Settings, LayoutDashboard, Command } from 'lucide-react';
import { SystemStatus } from '@/components/dashboard/SystemStatus';
import { RegimeIndicator } from '@/components/dashboard/RegimeIndicator';

const Index = () => {
  const [helperOpen, setHelperOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="h-screen flex flex-col bg-background w-full">
        {/* Header with System Status and Navigation */}
        <header className="border-b border-border bg-card px-4 py-2 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-foreground">Quant Chat Workbench</h1>
            {/* Cmd+K hint */}
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted-foreground bg-muted rounded-md border cursor-pointer hover:bg-accent"
                 onClick={() => {
                   const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
                   document.dispatchEvent(event);
                 }}>
              <Command className="h-3 w-3" />K
            </kbd>
          </div>

          {/* System Status (Heartbeat) + Regime */}
          <div className="flex items-center gap-4">
            <RegimeIndicator />
            <SystemStatus />

            <div className="flex items-center gap-2 border-l pl-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/dashboard')}
                title="Conductor's Dashboard"
              >
                <LayoutDashboard className="h-4 w-4 mr-1" />
                Dashboard
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/settings')}
                title="Settings"
              >
                <Settings className="h-4 w-4 mr-1" />
                Settings
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setHelperOpen(true)}
                title="Getting Started Helper"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        {/* Main Layout */}
        <div className="flex-1 min-h-0">
          <MainLayout
            leftPanel={
              <>
                <WorkspaceSelector />
                <ChatSessionList />
              </>
            }
            centerPanel={<ChatArea />}
            rightPanel={<RightPanel />}
          />
        </div>

        {/* Visualization Container Overlay */}
        <VisualizationContainer />

        <HelperChatDialog open={helperOpen} onOpenChange={setHelperOpen} />
      </div>
    </SidebarProvider>
  );
};

export default Index;
