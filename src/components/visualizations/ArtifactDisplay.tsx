/**
 * Artifact Display - Shows code, configs, reports, and analysis scripts
 * with educational annotations
 */

import { Artifact } from '@/types/api-contract';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, FileCode, FileText, Settings, Code } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ArtifactDisplayProps {
  artifact: Artifact;
  onClose: () => void;
}

const artifactIcons = {
  annotated_code: FileCode,
  configuration: Settings,
  research_report: FileText,
  analysis_script: Code,
};

const artifactLabels = {
  annotated_code: 'Strategy Code',
  configuration: 'Configuration',
  research_report: 'Research Report',
  analysis_script: 'Analysis Script',
};

export const ArtifactDisplay = ({ artifact, onClose }: ArtifactDisplayProps) => {
  const Icon = artifactIcons[artifact.type];
  const label = artifactLabels[artifact.type];

  return (
    <Card className="h-full flex flex-col bg-card/95 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <div>
            <h3 className="font-semibold text-sm">{artifact.title}</h3>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {artifact.type === 'research_report' ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <div dangerouslySetInnerHTML={{ __html: formatReport(artifact.content) }} />
            </div>
          ) : (
            <pre className={cn(
              "font-mono text-xs leading-relaxed",
              "p-4 rounded-lg bg-muted/50",
              "overflow-x-auto"
            )}>
              <code className={artifact.language ? `language-${artifact.language}` : ''}>
                {artifact.content}
              </code>
            </pre>
          )}

          {/* Annotations */}
          {artifact.annotations && artifact.annotations.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground">
                Educational Notes
              </h4>
              {artifact.annotations.map((annotation, i) => (
                <Card key={i} className="p-3 bg-primary/5 border-primary/20">
                  <div className="flex gap-2">
                    <span className="text-xs font-mono text-muted-foreground">
                      Line {annotation.line}:
                    </span>
                    <p className="text-xs text-foreground flex-1">
                      {annotation.text}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-border bg-muted/50">
        <p className="text-xs text-muted-foreground text-center">
          This artifact provides educational transparency into what's actually running
        </p>
      </div>
    </Card>
  );
};

// Simple markdown-like formatting for reports
function formatReport(content: string): string {
  return content
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gim, '<p>$1</p>')
    .replace(/<\/p><p><h/g, '</p><h')
    .replace(/<\/h[1-3]><\/p>/g, '</h>');
}
