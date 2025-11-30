import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { MainLayout } from '@/components/layout/MainLayout';
import { ChatArea } from '@/components/chat/ChatArea';
import { DualPurposePanel } from '@/components/visualizations/DualPurposePanel';
import { RoadmapTracker } from '@/components/research/RoadmapTracker';
import { HelperChatDialog } from '@/components/chat/HelperChatDialog';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { ResumeTaskDialog, type UnfinishedTask } from '@/components/research';
import { DemoModeButton } from '@/components/visualizations/DemoModeButton';
import { Button } from '@/components/ui/button';
import { HelpCircle, Settings, LayoutDashboard, Command } from 'lucide-react';
import { SystemStatus } from '@/components/dashboard/SystemStatus';
import { RegimeIndicator } from '@/components/dashboard/RegimeIndicator';
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
        {/* Header with System Status and Navigation - ALWAYS VISIBLE */}
        <header className="sticky top-0 z-50 border-b border-border bg-card px-4 py-2.5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
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

        {/* Main Content with Sidebar */}
        <div className="flex-1 flex min-h-0 w-full">
          <ChatSidebar />
          
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
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
