/**
 * Right Panel - Visual Research Dashboard
 * Top: Visualization/Artifact display
 * Bottom: Roadmap & Learning Center & Findings tabs
 */

import { RoadmapTracker } from '@/components/research/RoadmapTracker';
import { LearningCenter } from '@/components/research/LearningCenter';
import { FindingsPanel } from '@/components/research/FindingsPanel';
import { DualPurposePanel } from '@/components/visualizations/DualPurposePanel';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, MapIcon, Star } from 'lucide-react';

export const RightPanel = () => {
  return (
    <ResizablePanelGroup direction="vertical" className="h-full">
      {/* Top 60%: Visualization / Artifact Display */}
      <ResizablePanel defaultSize={60} minSize={40}>
        <DualPurposePanel />
      </ResizablePanel>

      <ResizableHandle />

      {/* Bottom 40%: Roadmap & Learning Center & Findings */}
      <ResizablePanel defaultSize={40} minSize={30}>
        <div className="h-full p-4">
          <Tabs defaultValue="roadmap" className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-3 mb-3">
              <TabsTrigger value="roadmap" className="flex items-center gap-2">
                <MapIcon className="h-4 w-4" />
                Roadmap
              </TabsTrigger>
              <TabsTrigger value="learning" className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Learning
              </TabsTrigger>
              <TabsTrigger value="findings" className="flex items-center gap-2">
                <Star className="h-4 w-4" />
                Findings
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="roadmap" className="flex-1 mt-0">
              <RoadmapTracker />
            </TabsContent>
            
            <TabsContent value="learning" className="flex-1 mt-0">
              <LearningCenter />
            </TabsContent>

            <TabsContent value="findings" className="flex-1 mt-0">
              <FindingsPanel />
            </TabsContent>
          </Tabs>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
