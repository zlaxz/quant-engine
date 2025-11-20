import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { ChatSessionList } from '@/components/chat/ChatSessionList';
import { ChatArea } from '@/components/chat/ChatArea';
import { RightPanel } from '@/components/panels/RightPanel';
import { HelperChatDialog } from '@/components/chat/HelperChatDialog';
import { Button } from '@/components/ui/button';
import { HelpCircle } from 'lucide-react';

const Index = () => {
  const [helperOpen, setHelperOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header with Help Button */}
      <header className="border-b border-border bg-card px-4 py-2 flex items-center justify-between flex-shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Quant Chat Workbench</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setHelperOpen(true)}
          title="Getting Started Helper"
        >
          <HelpCircle className="h-5 w-5" />
        </Button>
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

      <HelperChatDialog open={helperOpen} onOpenChange={setHelperOpen} />
    </div>
  );
};

export default Index;
