import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { MainLayout } from '@/components/layout/MainLayout';
import { ChatArea } from '@/components/chat/ChatArea';
import { DualPurposePanel } from '@/components/visualizations/DualPurposePanel';
import { RoadmapTracker } from '@/components/research/RoadmapTracker';
import { MissionControl } from '@/components/research/MissionControl';
import { StatusStripEnhanced } from '@/components/research/StatusStripEnhanced';
import { HelperChatDialog } from '@/components/chat/HelperChatDialog';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { ResumeTaskDialog, type UnfinishedTask } from '@/components/research';
import { DemoModeButton } from '@/components/visualizations/DemoModeButton';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { HelpCircle, Settings, LayoutDashboard, Command, ListOrdered, Map } from 'lucide-react';
import { SystemStatus } from '@/components/dashboard/SystemStatus';
import { RegimeIndicator } from '@/components/dashboard/RegimeIndicator';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const [helperOpen, setHelperOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [unfinishedTasks, setUnfinishedTasks] = useState<UnfinishedTask[]>([]);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Check if first launch
  useEffect(() => {
    const hasCompletedOnboarding = localStorage.getItem('quantos_onboarding_completed');
    if (!hasCompletedOnboarding) {
      setOnboardingOpen(true);
    }
  }, []);

  // Check for unfinished tasks on startup (Phase 6: Working Memory Checkpoints)
  useEffect(() => {
    const checkForUnfinishedTasks = async () => {
      if (!window.electron?.checkpointGetActive) return;

      try {
        const result = await window.electron.checkpointGetActive();
        if (result.success && result.checkpoints.length > 0) {
          // Convert checkpoint format to UnfinishedTask format
          const tasks: UnfinishedTask[] = result.checkpoints.map(cp => ({
            id: cp.id,
            task: cp.task,
            progress: cp.progress,
            completedSteps: cp.completedSteps || [],
            nextSteps: cp.nextSteps || [],
            filesModified: cp.filesModified || [],
            lastCheckpointAt: cp.executionContext.lastCheckpointAt,
            estimatedTimeRemaining: cp.executionContext.estimatedTimeRemaining,
          }));
          setUnfinishedTasks(tasks);
        }
      } catch (error) {
        console.error('Failed to check for unfinished tasks:', error);
      }
    };

    checkForUnfinishedTasks();
  }, []);

  return (
    <SidebarProvider defaultOpen>
      <div className="h-screen flex flex-col bg-background w-full">
        {/* Header with System Status and Navigation */}
        <header className="sticky top-0 z-50 border-b border-border bg-card px-3 py-2 flex items-center gap-3 flex-shrink-0 min-h-[52px]">
          {/* Left section - always visible */}
          <div className="flex items-center gap-3 shrink-0">
            <SidebarTrigger />
            <h1 className="text-base font-semibold text-foreground whitespace-nowrap">QuantOS Research IDE</h1>
          </div>

          {/* Center section - status indicators, hidden on small screens */}
          <div className="hidden md:flex items-center gap-2 flex-1 justify-center min-w-0">
            <DemoModeButton />
            <RegimeIndicator />
            <SystemStatus />
          </div>

          {/* Right section - navigation */}
          <div className="flex items-center gap-1 shrink-0 ml-auto">
            {/* Cmd+K hint - hidden on small screens */}
            <kbd 
              className="hidden lg:inline-flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted-foreground bg-muted rounded border cursor-pointer hover:bg-accent mr-2"
              onClick={() => {
                const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
                document.dispatchEvent(event);
              }}
            >
              <Command className="h-3 w-3" />K
            </kbd>
            
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => navigate('/dashboard')}
              title="Dashboard"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden lg:inline ml-1.5">Dashboard</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => navigate('/settings')}
              title="Settings"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden lg:inline ml-1.5">Settings</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setHelperOpen(true)}
              title="Help"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
            <ThemeToggle />
          </div>
        </header>

        {/* Enhanced Status Strip */}
        <StatusStripEnhanced />

        {/* Main Content with Sidebar */}
        <div className="flex-1 flex min-h-0 w-full">
          <ChatSidebar />
          
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <MainLayout
              leftPanel={<ChatArea />}
              rightPanel={
                <ResizablePanelGroup direction="vertical" className="h-full">
                  {/* Top - Dual Purpose Panel (Visualizations / Artifacts) */}
                  <ResizablePanel defaultSize={50} minSize={20} maxSize={80}>
                    <div className="h-full overflow-hidden">
                      <DualPurposePanel />
                    </div>
                  </ResizablePanel>
                  
                  <ResizableHandle withHandle />
                  
                  {/* Bottom - Tabbed Roadmap & Mission Control */}
                  <ResizablePanel defaultSize={50} minSize={20} maxSize={80}>
                    <Tabs defaultValue="roadmap" className="h-full flex flex-col">
                      <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-9 px-2">
                        <TabsTrigger value="roadmap" className="gap-1.5 data-[state=active]:bg-muted">
                          <Map className="h-3.5 w-3.5" />
                          Roadmap
                        </TabsTrigger>
                        <TabsTrigger value="mission" className="gap-1.5 data-[state=active]:bg-muted">
                          <ListOrdered className="h-3.5 w-3.5" />
                          Queue
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="roadmap" className="flex-1 overflow-auto p-4 mt-0">
                        <RoadmapTracker />
                      </TabsContent>
                      <TabsContent value="mission" className="flex-1 overflow-hidden mt-0">
                        <MissionControl className="h-full border-0 rounded-none" />
                      </TabsContent>
                    </Tabs>
                  </ResizablePanel>
                </ResizablePanelGroup>
              }
            />
          </div>
        </div>

        <HelperChatDialog open={helperOpen} onOpenChange={setHelperOpen} />
        <OnboardingWizard 
          open={onboardingOpen} 
          onComplete={() => setOnboardingOpen(false)}
          onSkip={() => setOnboardingOpen(false)}
        />

        {/* Resume Task Dialog (Phase 6: Working Memory Checkpoints) */}
        <ResumeTaskDialog
          tasks={unfinishedTasks}
          onResume={async (taskId) => {
            try {
              const task = unfinishedTasks.find(t => t.id === taskId);
              if (!task) return;

              toast({
                title: 'Resuming Task',
                description: `Continuing: ${task.task.slice(0, 50)}...`,
              });

              setUnfinishedTasks(prev => prev.filter(t => t.id !== taskId));
            } catch (error) {
              console.error('Failed to resume task:', error);
              toast({
                title: 'Resume Failed',
                description: 'Could not resume task execution',
                variant: 'destructive',
              });
            }
          }}
          onAbandon={async (taskId) => {
            if (!window.electron?.checkpointAbandon) return;
            
            try {
              await window.electron.checkpointAbandon(taskId);
              setUnfinishedTasks(prev => prev.filter(t => t.id !== taskId));
              toast({
                title: 'Task Abandoned',
                description: 'The interrupted task has been removed.',
              });
            } catch (error) {
              console.error('Failed to abandon task:', error);
            }
          }}
          onViewDetails={(taskId) => {
            const task = unfinishedTasks.find(t => t.id === taskId);
            if (task) {
              toast({
                title: 'Task Details',
                description: task.task,
                duration: 5000,
              });
            }
          }}
        />
      </div>
    </SidebarProvider>
  );
};

export default Index;
