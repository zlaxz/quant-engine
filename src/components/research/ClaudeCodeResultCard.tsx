/**
 * Claude Code Result Card - Phase 5: Structured Artifacts
 * Interactive display of Claude Code execution results with undo/retry capabilities
 */

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { 
  Check, 
  RotateCcw, 
  Undo2, 
  FileCode, 
  TestTube, 
  DollarSign, 
  AlertCircle,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { ClaudeCodeArtifact } from '@/types/api-contract';
import { useToast } from '@/hooks/use-toast';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface ClaudeCodeResultCardProps {
  artifact: ClaudeCodeArtifact;
  onAccept?: () => void;
  onRetry?: (modifiedTask: string, parameters?: Record<string, any>) => void;
  onUndo?: () => void;
  className?: string;
}

export const ClaudeCodeResultCard = ({
  artifact,
  onAccept,
  onRetry,
  onUndo,
  className,
}: ClaudeCodeResultCardProps) => {
  const { toast } = useToast();
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const [modifiedTask, setModifiedTask] = useState(artifact.executionContext?.task || '');
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFileExpansion = (filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const handleAccept = () => {
    toast({
      title: 'Changes Accepted',
      description: 'Claude Code changes have been applied to your project.',
    });
    onAccept?.();
  };

  const handleRetry = () => {
    if (!modifiedTask.trim()) {
      toast({
        title: 'Task Required',
        description: 'Please provide a task description for retry.',
        variant: 'destructive',
      });
      return;
    }
    
    onRetry?.(modifiedTask, artifact.executionContext?.parameters);
    setRetryDialogOpen(false);
    toast({
      title: 'Retrying Claude Code',
      description: 'Executing with modified parameters...',
    });
  };

  const handleUndo = () => {
    onUndo?.();
    toast({
      title: 'Changes Reverted',
      description: 'Attempting alternative approach...',
    });
  };

  const hasTests = artifact.tests && (artifact.tests.passed > 0 || artifact.tests.failed > 0);
  const hasCostSummary = artifact.costSummary !== undefined;

  return (
    <>
      <Card className={className}>
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-1">{artifact.title}</h3>
              {artifact.executionContext && (
                <p className="text-sm text-muted-foreground">
                  {artifact.executionContext.task}
                </p>
              )}
            </div>
            {hasTests && (
              <Badge variant={artifact.tests!.failed === 0 ? 'default' : 'destructive'}>
                {artifact.tests!.passed} Passed / {artifact.tests!.failed} Failed
              </Badge>
            )}
          </div>

          {/* Tabbed Content */}
          <Tabs defaultValue="code" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="code">
                <FileCode className="h-4 w-4 mr-2" />
                Code
              </TabsTrigger>
              <TabsTrigger value="tests" disabled={!hasTests}>
                <TestTube className="h-4 w-4 mr-2" />
                Tests
              </TabsTrigger>
              <TabsTrigger value="explanation">
                <AlertCircle className="h-4 w-4 mr-2" />
                Explanation
              </TabsTrigger>
              <TabsTrigger value="cost" disabled={!hasCostSummary}>
                <DollarSign className="h-4 w-4 mr-2" />
                Cost
              </TabsTrigger>
            </TabsList>

            {/* Code Tab */}
            <TabsContent value="code" className="mt-4">
              <ScrollArea className="h-[400px] w-full border rounded-md p-4">
                <div className="space-y-4">
                  {artifact.files.map((file) => (
                    <Collapsible 
                      key={file.path}
                      open={expandedFiles.has(file.path)}
                      onOpenChange={() => toggleFileExpansion(file.path)}
                    >
                      <div className="border rounded-lg">
                        <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-accent">
                          <div className="flex items-center gap-2">
                            {expandedFiles.has(file.path) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            <FileCode className="h-4 w-4" />
                            <span className="font-mono text-sm">{file.path}</span>
                          </div>
                          {file.annotations && file.annotations.length > 0 && (
                            <Badge variant="secondary">
                              {file.annotations.length} annotations
                            </Badge>
                          )}
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="p-4 bg-muted">
                            <pre className="text-xs font-mono overflow-x-auto">
                              <code>{file.content}</code>
                            </pre>
                            {file.annotations && file.annotations.length > 0 && (
                              <div className="mt-4 space-y-2 border-t pt-4">
                                <p className="text-sm font-semibold">Annotations:</p>
                                {file.annotations.map((annotation, idx) => (
                                  <div key={idx} className="text-xs p-2 bg-background rounded">
                                    <span className="font-semibold">Line {annotation.line}:</span>{' '}
                                    {annotation.text}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Tests Tab */}
            <TabsContent value="tests" className="mt-4">
              <ScrollArea className="h-[400px] w-full border rounded-md p-4">
                {artifact.tests && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Check className="h-5 w-5 text-green-600" />
                        <span className="font-semibold">{artifact.tests.passed} Passed</span>
                      </div>
                      {artifact.tests.failed > 0 && (
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-5 w-5 text-destructive" />
                          <span className="font-semibold">{artifact.tests.failed} Failed</span>
                        </div>
                      )}
                    </div>
                    {artifact.tests.output && (
                      <div className="mt-4">
                        <p className="text-sm font-semibold mb-2">Test Output:</p>
                        <pre className="text-xs font-mono bg-muted p-4 rounded overflow-x-auto">
                          {artifact.tests.output}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Explanation Tab */}
            <TabsContent value="explanation" className="mt-4">
              <ScrollArea className="h-[400px] w-full border rounded-md p-4">
                <div className="prose prose-sm max-w-none">
                  <div className="whitespace-pre-wrap">{artifact.content}</div>
                  
                  {artifact.nextActions && artifact.nextActions.length > 0 && (
                    <div className="mt-6">
                      <h4 className="font-semibold mb-2">Recommended Next Actions:</h4>
                      <ul className="space-y-1">
                        {artifact.nextActions.map((action, idx) => (
                          <li key={idx} className="text-sm">{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {artifact.validation && Object.keys(artifact.validation).length > 0 && (
                    <div className="mt-6">
                      <h4 className="font-semibold mb-2">Validation Results:</h4>
                      <pre className="text-xs font-mono bg-muted p-4 rounded overflow-x-auto">
                        {JSON.stringify(artifact.validation, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Cost Tab */}
            <TabsContent value="cost" className="mt-4">
              <ScrollArea className="h-[400px] w-full border rounded-md p-4">
                {artifact.costSummary && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-4 border rounded-lg">
                        <p className="text-sm text-muted-foreground mb-1">This Execution</p>
                        <p className="text-2xl font-bold">
                          ${artifact.costSummary.thisExecution.toFixed(4)}
                        </p>
                      </div>
                      <div className="text-center p-4 border rounded-lg">
                        <p className="text-sm text-muted-foreground mb-1">Alternative Cost</p>
                        <p className="text-2xl font-bold">
                          ${artifact.costSummary.alternativeCost.toFixed(4)}
                        </p>
                      </div>
                      <div className="text-center p-4 border rounded-lg bg-green-50 dark:bg-green-950">
                        <p className="text-sm text-muted-foreground mb-1">Savings</p>
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                          ${artifact.costSummary.savings.toFixed(4)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <p className="text-sm">
                        <strong>Cost Efficiency:</strong> Claude Code saved approximately{' '}
                        {((artifact.costSummary.savings / artifact.costSummary.alternativeCost) * 100).toFixed(1)}%
                        compared to alternative approaches.
                      </p>
                    </div>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-4 pt-4 border-t">
            <Button onClick={handleAccept} className="flex-1">
              <Check className="h-4 w-4 mr-2" />
              Use This
            </Button>
            <Button variant="outline" onClick={() => setRetryDialogOpen(true)} className="flex-1">
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry with Changes
            </Button>
            <Button variant="ghost" onClick={handleUndo} className="flex-1">
              <Undo2 className="h-4 w-4 mr-2" />
              Undo & Try Different Approach
            </Button>
          </div>
        </div>
      </Card>

      {/* Retry Dialog */}
      <Dialog open={retryDialogOpen} onOpenChange={setRetryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retry with Modified Parameters</DialogTitle>
            <DialogDescription>
              Adjust the task description or parameters to refine the execution.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="modified-task">Task Description</Label>
              <Textarea
                id="modified-task"
                value={modifiedTask}
                onChange={(e) => setModifiedTask(e.target.value)}
                placeholder="Describe what you want Claude Code to do..."
                rows={4}
              />
            </div>
            {artifact.executionContext?.parameters && (
              <div className="space-y-2">
                <Label>Current Parameters</Label>
                <pre className="text-xs font-mono bg-muted p-3 rounded overflow-x-auto">
                  {JSON.stringify(artifact.executionContext.parameters, null, 2)}
                </pre>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetryDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRetry}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry Execution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
