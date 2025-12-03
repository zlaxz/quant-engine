/**
 * Right Panel - Visual Research Dashboard
 * Top: Visualization/Artifact display
 * Bottom: Roadmap & Learning Center & Findings tabs
 */

import { RoadmapTracker } from '@/components/research/RoadmapTracker';
import { LearningCenter } from '@/components/research/LearningCenter';
import { FindingsPanel } from '@/components/research/FindingsPanel';
import { ConversationTimeline } from '@/components/research/ConversationTimeline';
import { ClaudeCodeHistory, type ClaudeCodeCommand } from '@/components/research/ClaudeCodeCommandPreview';
import { DualPurposePanel } from '@/components/visualizations/DualPurposePanel';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, MapIcon, Star, Clock, Terminal } from 'lucide-react';
import { useState, useEffect } from 'react';

export const RightPanel = () => {
  const [claudeCodeCommands, setClaudeCodeCommands] = useState<ClaudeCodeCommand[]>([]);

  // Listen for Claude Code events from Electron
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electron?.onClaudeCodeEvent) {
      const cleanup = window.electron.onClaudeCodeEvent((event: { type: string; data: any }) => {
        if (event.type === 'decision' || event.type === 'progress') {
          const eventData = event.data as any;
          const command: ClaudeCodeCommand = {
            id: `cc-${Date.now()}`,
            task: eventData.task || eventData.decision?.task || 'Unknown task',
            context: eventData.context,
            files: eventData.files,
            timestamp: eventData.startTime || Date.now(),
            model: 'claude-code',
            timeout: eventData.timeout
          };
          
          // Add command if it's new
          setClaudeCodeCommands(prev => {
            const existing = prev.find(c => c.task === command.task);
            if (existing) return prev;
            return [command, ...prev].slice(0, 20); // Keep last 20
          });
        }
      });

      return cleanup;
    }
    return undefined;
  }, []);

  return (
    <ResizablePanelGroup direction="vertical" className="h-full">
      {/* Top 60%: Visualization / Artifact Display */}
      <ResizablePanel defaultSize={60} minSize={40}>
        <DualPurposePanel />
      </ResizablePanel>

      <ResizableHandle />

      {/* Bottom 40%: Roadmap & Learning Center & Findings & Commands */}
      <ResizablePanel defaultSize={40} minSize={30}>
        <div className="h-full p-4">
          <Tabs defaultValue="roadmap" className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-5 mb-3">
              <TabsTrigger value="roadmap" className="flex items-center gap-1.5 text-xs">
                <MapIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Roadmap</span>
              </TabsTrigger>
              <TabsTrigger value="timeline" className="flex items-center gap-1.5 text-xs">
                <Clock className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Timeline</span>
              </TabsTrigger>
              <TabsTrigger value="commands" className="flex items-center gap-1.5 text-xs">
                <Terminal className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Commands</span>
                {claudeCodeCommands.length > 0 && (
                  <span className="ml-1 bg-primary text-primary-foreground rounded-full h-4 w-4 text-[10px] flex items-center justify-center">
                    {claudeCodeCommands.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="learning" className="flex items-center gap-1.5 text-xs">
                <BookOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Learn</span>
              </TabsTrigger>
              <TabsTrigger value="findings" className="flex items-center gap-1.5 text-xs">
                <Star className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Findings</span>
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="roadmap" className="flex-1 mt-0 overflow-auto">
              <RoadmapTracker />
            </TabsContent>
            
            <TabsContent value="timeline" className="flex-1 mt-0 overflow-auto">
              <ConversationTimeline events={[]} />
            </TabsContent>
            
            <TabsContent value="commands" className="flex-1 mt-0 overflow-auto">
              <ClaudeCodeHistory commands={claudeCodeCommands} />
            </TabsContent>
            
            <TabsContent value="learning" className="flex-1 mt-0 overflow-auto">
              <LearningCenter />
            </TabsContent>

            <TabsContent value="findings" className="flex-1 mt-0 overflow-auto">
              <FindingsPanel />
            </TabsContent>
          </Tabs>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
