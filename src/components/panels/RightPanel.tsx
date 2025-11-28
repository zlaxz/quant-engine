/**
 * Right Panel - Visual Research Dashboard
 * Top: Visualization/Artifact display
 * Bottom: Roadmap & Learning Center tabs
 */

import { RoadmapTracker } from '@/components/research/RoadmapTracker';
import { LearningCenter } from '@/components/research/LearningCenter';
import { DualPurposePanel } from '@/components/visualizations/DualPurposePanel';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, MapIcon } from 'lucide-react';

export const RightPanel = () => {
  return (
    <ResizablePanelGroup direction="vertical" className="h-full">
      {/* Top 60%: Visualization / Artifact Display */}
      <ResizablePanel defaultSize={60} minSize={40}>
        <DualPurposePanel />
      </ResizablePanel>

      <ResizableHandle />

      {/* Bottom 40%: Roadmap & Learning Center */}
      <ResizablePanel defaultSize={40} minSize={30}>
        <div className="h-full p-4">
          <Tabs defaultValue="roadmap" className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-2 mb-3">
              <TabsTrigger value="roadmap" className="flex items-center gap-2">
                <MapIcon className="h-4 w-4" />
                Roadmap
              </TabsTrigger>
              <TabsTrigger value="learning" className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Learning
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="roadmap" className="flex-1 mt-0">
              <RoadmapTracker />
            </TabsContent>
            
            <TabsContent value="learning" className="flex-1 mt-0">
              <LearningCenter />
            </TabsContent>
          </Tabs>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
