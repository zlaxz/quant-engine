import { ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

interface MainLayoutProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
}

export const MainLayout = ({ leftPanel, rightPanel }: MainLayoutProps) => {
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full w-full bg-background text-foreground">
      {/* Left Panel - Chat Area */}
      <ResizablePanel defaultSize={65} minSize={30} maxSize={85}>
        <main className="h-full flex flex-col min-w-0 border-r border-border">
          {leftPanel}
        </main>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right Panel - Visualization + Roadmap */}
      <ResizablePanel defaultSize={35} minSize={15} maxSize={70}>
        <aside className="h-full flex flex-col bg-panel">
          {rightPanel}
        </aside>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
