import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, TrendingUp, Brain } from 'lucide-react';
import { QuantPanel } from '@/components/quant/QuantPanel';

export const RightPanel = () => {
  return (
    <Tabs defaultValue="context" className="flex-1 flex flex-col">
      <div className="border-b border-panel-border p-3">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="context" className="text-xs font-mono">
            <FileText className="h-3 w-3 mr-1" />
            Context
          </TabsTrigger>
          <TabsTrigger value="quant" className="text-xs font-mono">
            <TrendingUp className="h-3 w-3 mr-1" />
            Quant
          </TabsTrigger>
          <TabsTrigger value="memory" className="text-xs font-mono">
            <Brain className="h-3 w-3 mr-1" />
            Memory
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="context" className="flex-1 mt-0">
        <ScrollArea className="h-full p-4">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold font-mono mb-2">Session Context</h3>
              <p className="text-xs text-muted-foreground">
                Context information will appear here during chat sessions
              </p>
            </div>
            <div className="p-3 bg-muted rounded-md">
              <div className="text-xs font-mono text-muted-foreground">
                No active context
              </div>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="quant" className="flex-1 mt-0">
        <ScrollArea className="h-full p-4">
          <QuantPanel />
        </ScrollArea>
      </TabsContent>

      <TabsContent value="memory" className="flex-1 mt-0">
        <ScrollArea className="h-full p-4">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold font-mono mb-2">Memory Notes</h3>
              <p className="text-xs text-muted-foreground">
                Persistent notes and insights for this workspace
              </p>
            </div>
            <div className="p-3 bg-muted rounded-md">
              <div className="text-xs font-mono text-muted-foreground">
                No memory notes yet
              </div>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
};
