import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { ResearchStage, VisualizationType, FocusArea, VisualizationState } from '@/types/journey';
import { Artifact } from '@/types/api-contract';

interface ResearchDisplayContextType {
  state: VisualizationState;
  currentArtifact?: Artifact;
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
  }, []);

  return (
    <ResearchDisplayContext.Provider
      value={{
        state,
        currentArtifact,
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
