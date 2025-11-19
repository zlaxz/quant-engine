import { ReactNode } from 'react';

interface MainLayoutProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
}

export const MainLayout = ({ leftPanel, centerPanel, rightPanel }: MainLayoutProps) => {
  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      {/* Left Panel - Workspaces & Sessions */}
      <aside className="w-64 border-r border-border bg-panel flex flex-col">
        {leftPanel}
      </aside>

      {/* Center Panel - Chat Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {centerPanel}
      </main>

      {/* Right Panel - Context/Quant/Memory */}
      <aside className="w-80 border-l border-border bg-panel flex flex-col">
        {rightPanel}
      </aside>
    </div>
  );
};
