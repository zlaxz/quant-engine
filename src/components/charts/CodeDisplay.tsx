/**
 * CodeDisplay - Code Viewer Component
 *
 * Displays code with syntax highlighting, line numbers, annotations,
 * and copy/download functionality.
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Copy, Download, Check, Info, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react';
import { CodeData } from './types';

interface CodeDisplayProps {
  data: CodeData;
}

export function CodeDisplay({ data }: CodeDisplayProps) {
  const [copied, setCopied] = useState(false);
  const config = data.config || {};

  const handleCopy = async () => {
    await navigator.clipboard.writeText(data.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = config.fileName || `code.${getFileExtension(data.language)}`;
    const blob = new Blob([data.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>{data.title}</CardTitle>
              <Badge variant="secondary">{data.language}</Badge>
            </div>
            {data.description && <CardDescription>{data.description}</CardDescription>}
          </div>
          <div className="flex items-center gap-2">
            {config.copyable !== false && (
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
            )}
            {config.downloadable && (
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea
          className="rounded-md border bg-muted/50"
          style={{ maxHeight: config.maxHeight || 600 }}
        >
          <CodeBlock
            code={data.code}
            language={data.language}
            showLineNumbers={config.showLineNumbers !== false}
            highlightLines={config.highlightLines}
            annotations={config.annotations}
          />
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Code Block Component
// ============================================================================

interface CodeBlockProps {
  code: string;
  language: string;
  showLineNumbers: boolean;
  highlightLines?: number[];
  annotations?: CodeData['config']['annotations'];
}

function CodeBlock({
  code,
  language,
  showLineNumbers,
  highlightLines = [],
  annotations = [],
}: CodeBlockProps) {
  const lines = code.split('\n');

  return (
    <div className="relative">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => {
            const lineNumber = i + 1;
            const isHighlighted = highlightLines.includes(lineNumber);
            const annotation = annotations.find(a => a.line === lineNumber);

            return (
              <tr
                key={i}
                className={`${isHighlighted ? 'bg-yellow-500/10' : ''} hover:bg-muted/30 transition-colors`}
              >
                {showLineNumbers && (
                  <td className="select-none text-right pr-4 pl-4 py-1 text-muted-foreground text-xs border-r border-border w-12">
                    <div className="flex items-center justify-end gap-1">
                      {annotation && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              {getAnnotationIcon(annotation.type)}
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{annotation.text}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <span>{lineNumber}</span>
                    </div>
                  </td>
                )}
                <td className="pl-4 pr-4 py-1">
                  <code className="text-sm font-mono">
                    <SyntaxHighlight code={line} language={language} />
                  </code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Syntax Highlighting (Simple implementation)
// ============================================================================

interface SyntaxHighlightProps {
  code: string;
  language: string;
}

function SyntaxHighlight({ code, language }: SyntaxHighlightProps) {
  // Simple regex-based syntax highlighting
  // For production, consider using a library like Prism or highlight.js

  if (!code.trim()) {
    return <span className="text-muted-foreground/50">&nbsp;</span>;
  }

  const tokens = tokenize(code, language);

  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={getTokenClass(token.type)}>
          {token.value}
        </span>
      ))}
    </>
  );
}

interface Token {
  type: string;
  value: string;
}

function tokenize(code: string, language: string): Token[] {
  const tokens: Token[] = [];

  // Simple tokenization patterns
  const patterns = getLanguagePatterns(language);

  let remaining = code;
  while (remaining.length > 0) {
    let matched = false;

    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match && match.index === 0) {
        tokens.push({ type: pattern.type, value: match[0] });
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      tokens.push({ type: 'text', value: remaining[0] });
      remaining = remaining.slice(1);
    }
  }

  return tokens;
}

function getLanguagePatterns(language: string) {
  const common = [
    { type: 'comment', regex: /^\/\/.*|^\/\*[\s\S]*?\*\/|^#.*/ },
    { type: 'string', regex: /^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'|^`(?:[^`\\]|\\.)*`/ },
    { type: 'number', regex: /^-?\d+\.?\d*(?:[eE][+-]?\d+)?/ },
    { type: 'operator', regex: /^[+\-*/%=<>!&|^~?:]+/ },
    { type: 'punctuation', regex: /^[{}[\](),.;]/ },
    { type: 'whitespace', regex: /^\s+/ },
  ];

  const keywords: Record<string, string[]> = {
    python: ['def', 'class', 'if', 'else', 'elif', 'for', 'while', 'return', 'import', 'from', 'as', 'try', 'except', 'with', 'lambda', 'yield'],
    javascript: ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'class', 'extends', 'import', 'export', 'async', 'await'],
    typescript: ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'class', 'extends', 'import', 'export', 'async', 'await', 'interface', 'type'],
    java: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'if', 'else', 'for', 'while', 'return', 'new', 'void'],
    rust: ['fn', 'let', 'mut', 'if', 'else', 'match', 'for', 'while', 'return', 'struct', 'enum', 'impl', 'trait', 'pub', 'use'],
  };

  const langKeywords = keywords[language.toLowerCase()] || [];
  if (langKeywords.length > 0) {
    const keywordPattern = {
      type: 'keyword',
      regex: new RegExp(`^\\b(${langKeywords.join('|')})\\b`),
    };
    return [keywordPattern, ...common];
  }

  return common;
}

function getTokenClass(type: string): string {
  switch (type) {
    case 'keyword':
      return 'text-purple-600 dark:text-purple-400 font-semibold';
    case 'string':
      return 'text-green-600 dark:text-green-400';
    case 'number':
      return 'text-blue-600 dark:text-blue-400';
    case 'comment':
      return 'text-muted-foreground italic';
    case 'operator':
      return 'text-foreground';
    case 'punctuation':
      return 'text-foreground';
    case 'whitespace':
      return '';
    case 'text':
    default:
      return 'text-foreground';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getAnnotationIcon(type?: 'info' | 'warning' | 'error' | 'success') {
  switch (type) {
    case 'info':
      return <Info className="h-3 w-3 text-blue-500" />;
    case 'warning':
      return <AlertTriangle className="h-3 w-3 text-yellow-500" />;
    case 'error':
      return <AlertCircle className="h-3 w-3 text-red-500" />;
    case 'success':
      return <CheckCircle className="h-3 w-3 text-green-500" />;
    default:
      return <Info className="h-3 w-3 text-blue-500" />;
  }
}

function getFileExtension(language: string): string {
  const extensions: Record<string, string> = {
    python: 'py',
    javascript: 'js',
    typescript: 'ts',
    java: 'java',
    rust: 'rs',
    go: 'go',
    cpp: 'cpp',
    c: 'c',
    csharp: 'cs',
    ruby: 'rb',
    php: 'php',
    swift: 'swift',
    kotlin: 'kt',
    sql: 'sql',
    html: 'html',
    css: 'css',
    json: 'json',
    yaml: 'yaml',
    markdown: 'md',
    bash: 'sh',
    shell: 'sh',
  };

  return extensions[language.toLowerCase()] || 'txt';
}
