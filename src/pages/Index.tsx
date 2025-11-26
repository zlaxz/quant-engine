import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { ChatArea } from '@/components/chat/ChatArea';
import { DualPurposePanel } from '@/components/visualizations/DualPurposePanel';
import { RoadmapTracker } from '@/components/research/RoadmapTracker';
import { StatusStrip } from '@/components/research/StatusStrip';
import { HelperChatDialog } from '@/components/chat/HelperChatDialog';
import { DemoModeButton } from '@/components/visualizations/DemoModeButton';
import { Button } from '@/components/ui/button';
import { HelpCircle, Settings, LayoutDashboard, Command } from 'lucide-react';
import { SystemStatus } from '@/components/dashboard/SystemStatus';
import { RegimeIndicator } from '@/components/dashboard/RegimeIndicator';

const Index = () => {
  const [helperOpen, setHelperOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="h-screen flex flex-col bg-background w-full">
      {/* Header with System Status and Navigation - ALWAYS VISIBLE */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 px-4 py-3 flex items-center justify-between flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-foreground">QuantOS Research IDE</h1>
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
        <div className="flex items-center gap-3">
          <DemoModeButton />
          <div className="hidden sm:flex items-center gap-3">
            <RegimeIndicator />
            <SystemStatus />
          </div>

          <div className="flex items-center gap-2 border-l pl-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/dashboard')}
              title="Research Dashboard"
            >
              <LayoutDashboard className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Dashboard</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/settings')}
              title="Settings"
            >
              <Settings className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Settings</span>
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

      {/* Status Strip - Current Operation */}
      <StatusStrip />

      {/* Main Two-Column Layout */}
      <div className="flex-1 min-h-0">
        <MainLayout
          leftPanel={<ChatArea />}
          rightPanel={
            <>
              {/* Top 60% - Dual Purpose Panel (Visualizations / Artifacts) */}
              <div className="flex-[3] min-h-0 overflow-hidden">
                <DualPurposePanel />
              </div>
              
              {/* Bottom 40% - Roadmap Tracker */}
              <div className="flex-[2] min-h-0 border-t border-border p-4">
                <RoadmapTracker />
              </div>
            </>
          }
        />
      </div>

      <HelperChatDialog open={helperOpen} onOpenChange={setHelperOpen} />
    </div>
  );
};

export default Index;
