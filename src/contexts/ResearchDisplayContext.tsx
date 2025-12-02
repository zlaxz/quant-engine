import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { ResearchStage, VisualizationType, FocusArea, VisualizationState } from '@/types/journey';
import { Artifact } from '@/types/api-contract';
import { ChartData, TableData, MetricsData, CodeData } from '@/components/charts/types';

export type TaskCategory = 
  | 'Analysis'
  | 'Backtesting'
  | 'Code Review'
  | 'Pattern Mining'
  | 'Memory Curation'
  | 'Risk Review'
  | 'Experiment Planning'
  | 'Data Inspection'
  | 'Documentation';

export interface ResearchTask {
  id: string;
  description: string;
  category: TaskCategory;
  addedAt: number;
}

interface ResearchDisplayContextType {
  // Existing (keep for backwards compat)
  state: VisualizationState;
  currentArtifact?: Artifact;
  tasks: ResearchTask[];

  // NEW: Dynamic data storage (using Record for React compatibility)
  charts: Record<string, ChartData>;
  tables: Record<string, TableData>;
  metrics: Record<string, MetricsData>;
  codeBlocks: Record<string, CodeData>;

  // Existing methods (keep)
  addTask: (description: string, category: TaskCategory) => void;
  completeTask: (taskId: string) => void;
  updateTask: (taskId: string, description: string) => void;
  updateStage: (stage: ResearchStage) => void;
  showVisualization: (viz: VisualizationType, params?: Record<string, string>) => void;
  hideVisualization: (viz: VisualizationType) => void;
  hideAllVisualizations: () => void;
  updateProgress: (percent: number, message?: string) => void;
  setFocus: (focus: FocusArea) => void;
  setCurrentOperation: (operation: string) => void;
  clearCurrentOperation: () => void;
  showArtifact: (artifact: Artifact) => void;
  clearArtifact: () => void;
  resetState: () => void;

  // NEW: Dynamic visualization methods
  showChart: (data: ChartData) => void;
  updateChart: (id: string, data: Partial<ChartData>) => void;
  hideChart: (id: string) => void;
  showTable: (data: TableData) => void;
  hideTable: (id: string) => void;
  showMetrics: (data: MetricsData) => void;
  hideMetrics: (id: string) => void;
  showCode: (data: CodeData) => void;
  hideCode: (id: string) => void;
  clearAllDynamic: () => void;
}

const ResearchDisplayContext = createContext<ResearchDisplayContextType | undefined>(undefined);

const initialState: VisualizationState = {
  currentStage: 'idle',
  activeVisualizations: [],
  progress: { percent: 0 },
  focusArea: 'hidden',
  operationStartTime: undefined,
  currentOperation: undefined,
};

export const ResearchDisplayProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<VisualizationState>(initialState);
  const [currentArtifact, setCurrentArtifact] = useState<Artifact | undefined>(undefined);
  const [tasks, setTasks] = useState<ResearchTask[]>([]);
  const [charts, setCharts] = useState<Record<string, ChartData>>({});
  const [tables, setTables] = useState<Record<string, TableData>>({});
  const [metrics, setMetrics] = useState<Record<string, MetricsData>>({});
  const [codeBlocks, setCodeBlocks] = useState<Record<string, CodeData>>({});

  // Task management functions
  const addTask = useCallback((description: string, category: TaskCategory) => {
    const newTask: ResearchTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      description,
      category,
      addedAt: Date.now()
    };
    setTasks(prev => [...prev, newTask]);
  }, []);

  const completeTask = useCallback((taskId: string) => {
    setTasks(prev => prev.filter(task => task.id !== taskId));
  }, []);

  const updateTask = useCallback((taskId: string, description: string) => {
    setTasks(prev => prev.map(task => 
      task.id === taskId ? { ...task, description } : task
    ));
  }, []);

  const updateStage = useCallback((stage: ResearchStage) => {
    setState(prev => ({
      ...prev,
      currentStage: stage,
      operationStartTime: Date.now(),
      progress: { percent: 0 },
    }));
  }, []);

  const showVisualization = useCallback((viz: VisualizationType, _params?: Record<string, string>) => {
    setState(prev => ({
      ...prev,
      activeVisualizations: [...new Set([...prev.activeVisualizations, viz])],
      focusArea: prev.focusArea === 'hidden' ? 'center' : prev.focusArea,
    }));
  }, []);

  const hideVisualization = useCallback((viz: VisualizationType) => {
    setState(prev => {
      const newVisualizations = prev.activeVisualizations.filter(v => v !== viz);
      return {
        ...prev,
        activeVisualizations: newVisualizations,
        focusArea: newVisualizations.length === 0 ? 'hidden' : prev.focusArea,
      };
    });
  }, []);

  const hideAllVisualizations = useCallback(() => {
    setState(prev => ({
      ...prev,
      activeVisualizations: [],
      focusArea: 'hidden',
    }));
  }, []);

  const updateProgress = useCallback((percent: number, message?: string) => {
    setState(prev => ({
      ...prev,
      progress: { percent, message },
    }));
  }, []);

  const setFocus = useCallback((focus: FocusArea) => {
    setState(prev => ({
      ...prev,
      focusArea: focus,
    }));
  }, []);

  const setCurrentOperation = useCallback((operation: string) => {
    setState(prev => ({
      ...prev,
      currentOperation: operation,
      operationStartTime: Date.now(),
    }));
  }, []);

  const clearCurrentOperation = useCallback(() => {
    setState(prev => ({
      ...prev,
      currentOperation: undefined,
      operationStartTime: undefined,
      progress: { percent: 0 },
    }));
  }, []);

  const showArtifact = useCallback((artifact: Artifact) => {
    setCurrentArtifact(artifact);
  }, []);

  const clearArtifact = useCallback(() => {
    setCurrentArtifact(undefined);
  }, []);

  const resetState = useCallback(() => {
    setState(initialState);
    setCurrentArtifact(undefined);
    setCharts({});
    setTables({});
    setMetrics({});
    setCodeBlocks({});
  }, []);

  // Dynamic visualization methods
  const showChart = useCallback((data: ChartData) => {
    setCharts(prev => ({ ...prev, [data.id]: data }));
  }, []);

  const updateChart = useCallback((id: string, updates: Partial<ChartData>) => {
    setCharts(prev => {
      const existing = prev[id];
      if (!existing) {
        console.warn(`[Context] Cannot update chart ${id}: not found`);
        return prev;
      }
      return { ...prev, [id]: { ...existing, ...updates } as ChartData };
    });
  }, []);

  const hideChart = useCallback((id: string) => {
    setCharts(prev => {
      const { [id]: removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const showTable = useCallback((data: TableData) => {
    setTables(prev => ({ ...prev, [data.id]: data }));
  }, []);

  const hideTable = useCallback((id: string) => {
    setTables(prev => {
      const { [id]: removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const showMetrics = useCallback((data: MetricsData) => {
    setMetrics(prev => ({ ...prev, [data.id]: data }));
  }, []);

  const hideMetrics = useCallback((id: string) => {
    setMetrics(prev => {
      const { [id]: removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const showCode = useCallback((data: CodeData) => {
    setCodeBlocks(prev => ({ ...prev, [data.id]: data }));
  }, []);

  const hideCode = useCallback((id: string) => {
    setCodeBlocks(prev => {
      const { [id]: removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const clearAllDynamic = useCallback(() => {
    setCharts({});
    setTables({});
    setMetrics({});
    setCodeBlocks({});
  }, []);

  return (
    <ResearchDisplayContext.Provider
      value={{
        // Existing
        state,
        currentArtifact,
        tasks,

        // NEW: Dynamic data storage
        charts,
        tables,
        metrics,
        codeBlocks,

        // Existing methods
        addTask,
        completeTask,
        updateTask,
        updateStage,
        showVisualization,
        hideVisualization,
        hideAllVisualizations,
        updateProgress,
        setFocus,
        setCurrentOperation,
        clearCurrentOperation,
        showArtifact,
        clearArtifact,
        resetState,

        // NEW: Dynamic visualization methods
        showChart,
        updateChart,
        hideChart,
        showTable,
        hideTable,
        showMetrics,
        hideMetrics,
        showCode,
        hideCode,
        clearAllDynamic,
      }}
    >
      {children}
    </ResearchDisplayContext.Provider>
  );
};

export const useResearchDisplay = () => {
  const context = useContext(ResearchDisplayContext);
  if (!context) {
    throw new Error('useResearchDisplay must be used within ResearchDisplayProvider');
  }
  return context;
};
