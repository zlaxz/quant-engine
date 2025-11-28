/**
 * Key Findings Data Structures
 * Tracks important discoveries during research
 */

export type FindingType = 
  | 'discovery'        // Strategy/regime performance discoveries
  | 'warning'          // Critical warnings (overfitting, bias, risk)
  | 'rule'             // Validated rules from memory
  | 'milestone'        // Milestone achievements
  | 'insight';         // User-saved insights

export type FindingImportance = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  type: FindingType;
  importance: FindingImportance;
  title: string;
  description: string;
  discoveredAt: string;
  tags?: string[];
  relatedRunId?: string;
  relatedMemoryId?: string;
  metadata?: Record<string, any>;
}

export interface FindingsFilter {
  types?: FindingType[];
  importance?: FindingImportance[];
  searchQuery?: string;
  tags?: string[];
}
