/**
 * Parser for Chief Quant display directives
 * Extracts visualization and artifact display commands from AI messages
 */

import { VisualizationType } from '@/types/journey';
import { ArtifactType } from '@/types/api-contract';

export interface DisplayDirective {
  type: 'visualization' | 'artifact' | 'stage' | 'progress';
  value: string;
  params?: Record<string, string>;
}

export interface ArtifactDirective {
  artifactType: ArtifactType;
  title: string;
  content: string;
  language?: string;
}

/**
 * Parse display directives from Chief Quant messages
 * Format: [DISPLAY: type, params]
 * Examples:
 *   [DISPLAY: regime_timeline]
 *   [DISPLAY: strategy_card, id=strat_001]
 *   [DISPLAY_ARTIFACT: annotated_code, title="Strategy Implementation"]
 */
export function parseDisplayDirectives(message: string): DisplayDirective[] {
  const directives: DisplayDirective[] = [];
  const regex = /\[DISPLAY(?:_ARTIFACT)?:\s*([^\]]+)\]/g;
  
  let match;
  while ((match = regex.exec(message)) !== null) {
    const content = match[1].trim();
    const isArtifact = match[0].includes('_ARTIFACT');
    
    // Split by comma to get type and params
    const parts = content.split(',').map(p => p.trim());
    const value = parts[0];
    
    const params: Record<string, string> = {};
    for (let i = 1; i < parts.length; i++) {
      const paramMatch = parts[i].match(/(\w+)=["']?([^"']+)["']?/);
      if (paramMatch) {
        params[paramMatch[1]] = paramMatch[2];
      }
    }
    
    directives.push({
      type: isArtifact ? 'artifact' : 'visualization',
      value,
      params,
    });
  }
  
  return directives;
}

/**
 * Extract artifact content from directive params
 */
export function parseArtifactDirective(directive: DisplayDirective): ArtifactDirective | null {
  if (directive.type !== 'artifact' || !directive.params) {
    return null;
  }
  
  return {
    artifactType: directive.value as ArtifactType,
    title: directive.params.title || 'Artifact',
    content: directive.params.content || '',
    language: directive.params.language,
  };
}

/**
 * Check if a visualization type is valid
 */
export function isValidVisualization(value: string): value is VisualizationType {
  const validTypes: VisualizationType[] = [
    'regime_timeline',
    'regime_distribution',
    'data_coverage',
    'discovery_matrix',
    'discovery_funnel',
    'swarm_grid',
    'performance_heatmap',
    'equity_curve_overlay',
    'parameter_sensitivity',
    'backtest_queue',
    'symphony',
    'greeks_dashboard',
    'allocation_sankey',
  ];
  
  return validTypes.includes(value as VisualizationType);
}

/**
 * Remove directives from message text for clean display
 */
export function stripDirectives(message: string): string {
  return message.replace(/\[DISPLAY(?:_ARTIFACT)?:\s*[^\]]+\]/g, '').trim();
}
