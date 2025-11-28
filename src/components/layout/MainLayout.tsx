import { ReactNode } from 'react';

interface MainLayoutProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
}

export const MainLayout = ({ leftPanel, rightPanel }: MainLayoutProps) => {
  return (
    <div className="flex h-full w-full bg-background text-foreground">
      {/* Left Panel - Chat Area (70%) */}
      <main className="flex-[7] flex flex-col min-w-0 border-r border-border">
        {leftPanel}
      </main>

      {/* Right Panel - Split (30%): Visualization (top 60%) + Roadmap (bottom 40%) */}
      <aside className="flex-[3] flex flex-col bg-panel">
        {rightPanel}
      </aside>
    </div>
  );
};
