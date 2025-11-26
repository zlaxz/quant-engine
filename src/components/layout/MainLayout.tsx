import { ReactNode } from 'react';

interface MainLayoutProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
}

export const MainLayout = ({ leftPanel, rightPanel }: MainLayoutProps) => {
  return (
    <div className="flex h-full w-full bg-background text-foreground">
      {/* Left Panel - Chat Area (60%) */}
      <main className="flex-[3] flex flex-col min-w-0 border-r border-border">
        {leftPanel}
      </main>

      {/* Right Panel - Split (40%): Visualization (top 60%) + Roadmap (bottom 40%) */}
      <aside className="flex-[2] flex flex-col bg-panel">
        {rightPanel}
      </aside>
    </div>
  );
};
