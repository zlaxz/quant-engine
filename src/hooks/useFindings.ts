/**
 * useFindings Hook - Manage findings state and actions
 */

import { useState, useCallback, useEffect } from 'react';
import { Finding, FindingType, FindingImportance } from '@/types/findings';
import { loadFindings, addFinding as addFindingToStorage, removeFinding as removeFindingFromStorage } from '@/lib/findingsStorage';

export function useFindings() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);

  // Load findings on mount
  useEffect(() => {
    const loaded = loadFindings();
    setFindings(loaded);
    setLoading(false);
  }, []);

  // Add a new finding
  const addFinding = useCallback((
    title: string,
    description: string,
    type: FindingType,
    importance: FindingImportance,
    metadata?: {
      tags?: string[];
      relatedRunId?: string;
      relatedMemoryId?: string;
      [key: string]: any;
    }
  ) => {
    const newFinding = addFindingToStorage({
      title,
      description,
      type,
      importance,
      tags: metadata?.tags,
      relatedRunId: metadata?.relatedRunId,
      relatedMemoryId: metadata?.relatedMemoryId,
      metadata,
    });

    setFindings(prev => [newFinding, ...prev]);
    return newFinding;
  }, []);

  // Remove a finding
  const removeFinding = useCallback((id: string) => {
    removeFindingFromStorage(id);
    setFindings(prev => prev.filter(f => f.id !== id));
  }, []);

  // Get findings by type
  const getFindingsByType = useCallback((type: FindingType) => {
    return findings.filter(f => f.type === type);
  }, [findings]);

  // Get critical findings
  const getCriticalFindings = useCallback(() => {
    return findings.filter(f => f.importance === 'critical');
  }, [findings]);

  return {
    findings,
    loading,
    addFinding,
    removeFinding,
    getFindingsByType,
    getCriticalFindings,
  };
}
