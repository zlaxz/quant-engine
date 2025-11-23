import { ReactNode } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from '@/components/ui/sidebar';

interface MainLayoutProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
}

export const MainLayout = ({ leftPanel, centerPanel, rightPanel }: MainLayoutProps) => {
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-full w-full bg-background text-foreground">
        {/* Collapsible Left Panel - Workspaces & Sessions */}
        <Sidebar collapsible="offcanvas" className="border-r border-border">
          <SidebarContent className="bg-panel">
            {leftPanel}
          </SidebarContent>
        </Sidebar>

        {/* Center Panel - Chat Area (includes trigger button in its own header) */}
        <main className="flex-1 flex flex-col min-w-0">
          {centerPanel}
        </main>

        {/* Right Panel - Context/Quant/Memory */}
        <aside className="w-80 border-l border-border bg-panel flex flex-col">
          {rightPanel}
        </aside>
      </div>
    </SidebarProvider>
  );
};
