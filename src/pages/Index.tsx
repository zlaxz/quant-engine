import { MainLayout } from '@/components/layout/MainLayout';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import { ChatSessionList } from '@/components/chat/ChatSessionList';
import { ChatArea } from '@/components/chat/ChatArea';
import { RightPanel } from '@/components/panels/RightPanel';

const Index = () => {
  return (
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
  );
};

export default Index;
