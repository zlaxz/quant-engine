/**
 * Mission Control Context - Shared state for operation queue and previews
 * Syncs between main app and popout windows via IPC
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { PendingClaudeCodeCommand } from '@/components/research/ClaudeCodePendingPreview';

export interface ScheduledOperation {
  id: string;
  type: 'backtest' | 'analysis' | 'scan' | 'python' | 'file_op' | 'llm_call';
  title: string;
  description: string;
  estimatedDuration?: string;
  priority: 'low' | 'normal' | 'high';
  status: 'queued' | 'pending_approval' | 'running' | 'completed' | 'failed' | 'cancelled';
  scheduledAt: number;
  startedAt?: number;
  completedAt?: number;
  progress?: number;
  details?: {
    files?: string[];
    dataRange?: string;
    strategy?: string;
    model?: string;
  };
}

export interface MissionControlState {
  pendingApprovals: PendingClaudeCodeCommand[];
  operationQueue: ScheduledOperation[];
  currentOperation: ScheduledOperation | null;
  completedOperations: ScheduledOperation[];
  isExpanded: boolean;
}

interface MissionControlContextValue {
  state: MissionControlState;
  addPendingApproval: (command: PendingClaudeCodeCommand) => void;
  removePendingApproval: (id: string) => void;
  addToQueue: (operation: Omit<ScheduledOperation, 'id' | 'scheduledAt' | 'status'>) => string;
  updateOperation: (id: string, updates: Partial<ScheduledOperation>) => void;
  removeFromQueue: (id: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  setCurrentOperation: (operation: ScheduledOperation | null) => void;
  completeOperation: (id: string, success: boolean) => void;
  toggleExpanded: () => void;
  clearCompleted: () => void;
}

const MissionControlContext = createContext<MissionControlContextValue | null>(null);

interface MissionControlProviderProps {
  children: ReactNode;
  initialState?: MissionControlState | null;
}

const defaultState: MissionControlState = {
  pendingApprovals: [],
  operationQueue: [],
  currentOperation: null,
  completedOperations: [],
  isExpanded: false,
};

export function MissionControlProvider({ children, initialState }: MissionControlProviderProps) {
  const [state, setState] = useState<MissionControlState>(initialState || defaultState);

  // Sync with initial state when it changes (for popout windows)
  useEffect(() => {
    if (initialState) {
      setState(initialState);
    }
  }, [initialState]);

  // Listen for IPC events from Electron (pending commands from Claude Code)
  useEffect(() => {
    if (!window.electron?.onClaudeCodePending) return;

    const cleanup = window.electron.onClaudeCodePending((command) => {
      // Type cast to handle parallelHint string -> union type
      const typedCommand: PendingClaudeCodeCommand = {
        ...command,
        parallelHint: command.parallelHint as PendingClaudeCodeCommand['parallelHint'],
      };
      setState(prev => ({
        ...prev,
        pendingApprovals: [...prev.pendingApprovals, typedCommand],
      }));
    });

    return cleanup;
  }, []);

  // Listen for tool execution events to track operations
  useEffect(() => {
    if (!window.electron?.onToolExecutionEvent) return;

    const cleanup = window.electron.onToolExecutionEvent((event) => {
      if (event.type === 'tool-start') {
        // Add as running operation
        const operation: ScheduledOperation = {
          id: `tool-${event.timestamp}`,
          type: mapToolToOperationType(event.tool),
          title: formatToolTitle(event.tool),
          description: event.whyThis || formatToolDescription(event.tool, event.args),
          priority: 'normal',
          status: 'running',
          scheduledAt: event.timestamp,
          startedAt: event.timestamp,
          details: {
            files: event.args?.file ? [event.args.file] : event.args?.files,
            model: event.args?.model,
          },
        };
        
        setState(prev => ({
          ...prev,
          currentOperation: operation,
        }));
      } else if (event.type === 'tool-complete' || event.type === 'tool-error') {
        setState(prev => {
          if (!prev.currentOperation) return prev;
          
          const completedOp: ScheduledOperation = {
            ...prev.currentOperation,
            status: event.type === 'tool-complete' ? 'completed' : 'failed',
            completedAt: event.timestamp,
          };
          
          return {
            ...prev,
            currentOperation: null,
            completedOperations: [completedOp, ...prev.completedOperations].slice(0, 50),
          };
        });
      }
    });

    return cleanup;
  }, []);

  // Listen for Claude Code events
  useEffect(() => {
    if (!window.electron?.onClaudeCodeEvent) return;

    const cleanup = window.electron.onClaudeCodeEvent((event) => {
      if (event.type === 'progress') {
        const progressData = event.data as { percent?: number; phase?: string };
        setState(prev => {
          if (!prev.currentOperation) return prev;
          return {
            ...prev,
            currentOperation: {
              ...prev.currentOperation,
              progress: progressData.percent,
              description: progressData.phase || prev.currentOperation.description,
            },
          };
        });
      } else if (event.type === 'complete' || event.type === 'error' || event.type === 'cancelled') {
        setState(prev => {
          if (!prev.currentOperation) return prev;
          
          const completedOp: ScheduledOperation = {
            ...prev.currentOperation,
            status: event.type === 'complete' ? 'completed' : event.type === 'cancelled' ? 'cancelled' : 'failed',
            completedAt: Date.now(),
          };
          
          return {
            ...prev,
            currentOperation: null,
            completedOperations: [completedOp, ...prev.completedOperations].slice(0, 50),
          };
        });
      }
    });

    return cleanup;
  }, []);

  // Broadcast state changes to popout windows
  useEffect(() => {
    window.electron?.popoutBroadcast?.('mission-control-update', state);
  }, [state]);

  const addPendingApproval = useCallback((command: PendingClaudeCodeCommand) => {
    setState(prev => ({
      ...prev,
      pendingApprovals: [...prev.pendingApprovals, command],
    }));
  }, []);

  const removePendingApproval = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      pendingApprovals: prev.pendingApprovals.filter(c => c.id !== id),
    }));
  }, []);

  const addToQueue = useCallback((operation: Omit<ScheduledOperation, 'id' | 'scheduledAt' | 'status'>): string => {
    const id = `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newOperation: ScheduledOperation = {
      ...operation,
      id,
      scheduledAt: Date.now(),
      status: 'queued',
    };
    
    setState(prev => ({
      ...prev,
      operationQueue: [...prev.operationQueue, newOperation],
    }));
    
    return id;
  }, []);

  const updateOperation = useCallback((id: string, updates: Partial<ScheduledOperation>) => {
    setState(prev => {
      // Update in queue
      const queueIndex = prev.operationQueue.findIndex(op => op.id === id);
      if (queueIndex !== -1) {
        const newQueue = [...prev.operationQueue];
        newQueue[queueIndex] = { ...newQueue[queueIndex], ...updates };
        return { ...prev, operationQueue: newQueue };
      }
      
      // Update current operation
      if (prev.currentOperation?.id === id) {
        return { ...prev, currentOperation: { ...prev.currentOperation, ...updates } };
      }
      
      return prev;
    });
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      operationQueue: prev.operationQueue.filter(op => op.id !== id),
    }));
  }, []);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setState(prev => {
      const newQueue = [...prev.operationQueue];
      const [removed] = newQueue.splice(fromIndex, 1);
      newQueue.splice(toIndex, 0, removed);
      return { ...prev, operationQueue: newQueue };
    });
  }, []);

  const setCurrentOperation = useCallback((operation: ScheduledOperation | null) => {
    setState(prev => ({ ...prev, currentOperation: operation }));
  }, []);

  const completeOperation = useCallback((id: string, success: boolean) => {
    setState(prev => {
      const operation = prev.currentOperation?.id === id 
        ? prev.currentOperation 
        : prev.operationQueue.find(op => op.id === id);
      
      if (!operation) return prev;
      
      const completedOp: ScheduledOperation = {
        ...operation,
        status: success ? 'completed' : 'failed',
        completedAt: Date.now(),
      };
      
      return {
        ...prev,
        currentOperation: prev.currentOperation?.id === id ? null : prev.currentOperation,
        operationQueue: prev.operationQueue.filter(op => op.id !== id),
        completedOperations: [completedOp, ...prev.completedOperations].slice(0, 50), // Keep last 50
      };
    });
  }, []);

  const toggleExpanded = useCallback(() => {
    setState(prev => ({ ...prev, isExpanded: !prev.isExpanded }));
  }, []);

  const clearCompleted = useCallback(() => {
    setState(prev => ({ ...prev, completedOperations: [] }));
  }, []);

  const value: MissionControlContextValue = {
    state,
    addPendingApproval,
    removePendingApproval,
    addToQueue,
    updateOperation,
    removeFromQueue,
    reorderQueue,
    setCurrentOperation,
    completeOperation,
    toggleExpanded,
    clearCompleted,
  };

  return (
    <MissionControlContext.Provider value={value}>
      {children}
    </MissionControlContext.Provider>
  );
}

export function useMissionControl() {
  const context = useContext(MissionControlContext);
  if (!context) {
    throw new Error('useMissionControl must be used within MissionControlProvider');
  }
  return context;
}

// Helper functions for mapping tool events to operations
function mapToolToOperationType(tool: string): ScheduledOperation['type'] {
  if (tool.includes('backtest') || tool.includes('strategy')) return 'backtest';
  if (tool.includes('python') || tool.includes('script')) return 'python';
  if (tool.includes('file') || tool.includes('read') || tool.includes('write')) return 'file_op';
  if (tool.includes('scan') || tool.includes('search')) return 'scan';
  if (tool.includes('llm') || tool.includes('chat')) return 'llm_call';
  return 'analysis';
}

function formatToolTitle(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatToolDescription(tool: string, args: Record<string, unknown>): string {
  const file = args?.file || args?.path;
  if (file) return `Operating on ${file}`;
  
  const query = args?.query;
  if (query) return `Searching: ${query}`;
  
  return `Executing ${tool}`;
}
