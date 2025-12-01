import { DisplayDirective, ResearchStage, VisualizationType, FocusArea } from '@/types/journey';
import { Artifact, ArtifactType } from '@/types/api-contract';
import {
  ChartData,
  TableData,
  MetricsData,
  CodeData,
  NotificationData,
  ChartUpdate,
  TableUpdate
} from '@/components/charts/types';

// Valid values for type checking
const VALID_STAGES: ResearchStage[] = [
  'idle', 'regime_mapping', 'strategy_discovery', 'backtesting',
  'tuning', 'analysis', 'portfolio', 'conclusion'
];

const VALID_VISUALIZATIONS: VisualizationType[] = [
  'regime_timeline', 'regime_distribution', 'data_coverage',
  'discovery_matrix', 'discovery_funnel', 'swarm_grid',
  'performance_heatmap', 'equity_curve_overlay', 'parameter_sensitivity',
  'backtest_queue', 'symphony', 'greeks_dashboard', 'allocation_sankey',
  'scenario_simulator'
];

const VALID_FOCUS_AREAS: FocusArea[] = ['center', 'right', 'modal', 'hidden'];

const DIRECTIVE_TYPES = ['stage', 'display', 'display_artifact', 'hide', 'progress', 'focus', 'todo_add', 'todo_complete', 'todo_update'];

const VALID_ARTIFACT_TYPES: ArtifactType[] = [
  'annotated_code', 'configuration', 'research_report', 'analysis_script'
];

/**
 * Parse display directives from Chief Quant responses
 * 
 * Directive formats:
 * [STAGE: regime_mapping]
 * [DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31]
 * [DISPLAY_ARTIFACT: annotated_code title="Strategy Implementation" content="..."]
 * [PROGRESS: 45 message="Classifying Q2 2021"]
 * [FOCUS: center]
 * [HIDE]
 */
export function parseDisplayDirectives(text: string): DisplayDirective[] {
  const directives: DisplayDirective[] = [];
  
  // Pattern: [DIRECTIVE: value param1=val1 param2=val2]
  // Only match known directive types to avoid false positives
  const directivePattern = new RegExp(`\\[(${DIRECTIVE_TYPES.join('|')}):?\\s*([^\\]]+)?\\]`, 'gi');
  
  let match;
  while ((match = directivePattern.exec(text)) !== null) {
    const directiveType = match[1].toLowerCase();
    const directiveValue = match[2]?.trim() || '';
    
    // Skip empty values (except for HIDE)
    if (!directiveValue && directiveType !== 'hide') {
      continue;
    }
    
    if (directiveType === 'stage') {
      // Validate stage name
      if (VALID_STAGES.includes(directiveValue as ResearchStage)) {
        directives.push({
          type: 'stage',
          value: directiveValue as ResearchStage,
        });
      } else {
        console.warn(`[Directive] Invalid stage: "${directiveValue}". Valid stages:`, VALID_STAGES);
      }
    } else if (directiveType === 'display') {
      const { value, params } = parseDirectiveValue(directiveValue);
      // Validate visualization name
      if (VALID_VISUALIZATIONS.includes(value as VisualizationType)) {
        directives.push({
          type: 'display',
          value: value as VisualizationType,
          params,
        });
      } else {
        console.warn(`[Directive] Invalid visualization: "${value}". Valid visualizations:`, VALID_VISUALIZATIONS);
      }
    } else if (directiveType === 'hide') {
      directives.push({
        type: 'hide',
        value: '',
      });
    } else if (directiveType === 'progress') {
      const { value, params } = parseDirectiveValue(directiveValue);
      directives.push({
        type: 'progress',
        value,
        params,
      });
    } else if (directiveType === 'focus') {
      // Validate focus area
      if (VALID_FOCUS_AREAS.includes(directiveValue as FocusArea)) {
        directives.push({
          type: 'focus',
          value: directiveValue as FocusArea,
        });
      } else {
        console.warn(`[Directive] Invalid focus area: "${directiveValue}". Valid areas:`, VALID_FOCUS_AREAS);
      }
    } else if (directiveType === 'todo_add') {
      // Format: [TODO_ADD:Category:Description]
      const [category, ...descParts] = directiveValue.split(':');
      const description = descParts.join(':').trim();
      if (category && description) {
        directives.push({
          type: 'todo_add',
          value: category,
          params: { description }
        });
      } else {
        const missingFields = [];
        if (!category) missingFields.push('category');
        if (!description) missingFields.push('description');
        console.warn(`[Directive] TODO_ADD missing required fields: ${missingFields.join(', ')}`);
      }
    } else if (directiveType === 'todo_complete') {
      // Format: [TODO_COMPLETE:task-id]
      if (directiveValue) {
        directives.push({
          type: 'todo_complete',
          value: directiveValue
        });
      } else {
        console.warn(`[Directive] TODO_COMPLETE missing required field: task-id`);
      }
    } else if (directiveType === 'todo_update') {
      // Format: [TODO_UPDATE:task-id:New description]
      const [taskId, ...descParts] = directiveValue.split(':');
      const description = descParts.join(':').trim();
      if (taskId && description) {
        directives.push({
          type: 'todo_update',
          value: taskId,
          params: { description }
        });
      } else {
        const missingFields = [];
        if (!taskId) missingFields.push('task-id');
        if (!description) missingFields.push('description');
        console.warn(`[Directive] TODO_UPDATE missing required fields: ${missingFields.join(', ')}`);
      }
    }
  }
  
  return directives;
}

/**
 * Parse directive value with optional parameters
 * Example: "regime_timeline from=2020-01-01 to=2024-12-31"
 * Returns: { value: "regime_timeline", params: { from: "2020-01-01", to: "2024-12-31" } }
 */
function parseDirectiveValue(input: string): { value: string; params: Record<string, string> } {
  const parts = input.split(/\s+/);
  const value = parts[0];
  const params: Record<string, string> = {};
  
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const [key, val] = part.split('=');
    if (key && val) {
      params[key] = val.replace(/['"]/g, '');
    }
  }
  
  return { value, params };
}

/**
 * Remove display directives from text for clean chat display
 * Only removes known directive types to preserve other bracketed content
 */
export function stripDisplayDirectives(text: string): string {
  let cleaned = text;

  // Strip data-driven directives with balanced brace matching
  const dataDrivenTypes = [
    'DISPLAY_CHART', 'DISPLAY_TABLE', 'DISPLAY_METRICS', 'DISPLAY_CODE',
    'UPDATE_CHART', 'UPDATE_TABLE', 'DISPLAY_NOTIFICATION'
  ];

  for (const type of dataDrivenTypes) {
    let searching = true;
    while (searching) {
      const jsonStr = extractJsonFromDirective(cleaned, type);
      if (!jsonStr) {
        searching = false;
        continue;
      }

      // Find and remove the complete directive [TYPE: {...}]
      const directiveStart = cleaned.indexOf(`[${type}:`);
      const jsonEnd = cleaned.indexOf(jsonStr) + jsonStr.length;

      // Look for ] immediately after JSON (skip whitespace only)
      let bracketEnd = jsonEnd;
      while (bracketEnd < cleaned.length) {
        const char = cleaned[bracketEnd];
        if (char === ']') break;
        if (char !== ' ' && char !== '\n' && char !== '\t') {
          // Non-whitespace before ] = malformed
          bracketEnd = -1;
          break;
        }
        bracketEnd++;
      }

      if (directiveStart !== -1 && bracketEnd !== -1 && bracketEnd < cleaned.length && cleaned[bracketEnd] === ']') {
        cleaned = cleaned.substring(0, directiveStart) + cleaned.substring(bracketEnd + 1);
      } else {
        console.warn(`[Strip] Malformed directive - no closing bracket found for ${type}`);
        searching = false;
      }
    }
  }

  // Strip old-style simple directives
  const directivePattern = new RegExp(`\\[(${DIRECTIVE_TYPES.join('|')}):?\\s*([^\\]]+)?\\]`, 'gi');
  cleaned = cleaned.replace(directivePattern, '');

  return cleaned.trim();
}

/**
 * Check if text contains display directives
 */
export function hasDisplayDirectives(text: string): boolean {
  return /\[(\w+):?\s*([^\]]+)?\]/.test(text);
}

/**
 * Extract stage from directives
 */
export function extractStage(directives: DisplayDirective[]): ResearchStage | null {
  const stageDirective = directives.find(d => d.type === 'stage');
  return stageDirective ? (stageDirective.value as ResearchStage) : null;
}

/**
 * Extract visualizations to display
 */
export function extractVisualizations(directives: DisplayDirective[]): VisualizationType[] {
  return directives
    .filter(d => d.type === 'display')
    .map(d => d.value as VisualizationType);
}

/**
 * Extract progress update
 */
export function extractProgress(directives: DisplayDirective[]): { percent: number; message?: string } | null {
  const progressDirective = directives.find(d => d.type === 'progress');
  if (!progressDirective) return null;
  
  const percent = parseInt(progressDirective.value);
  const message = progressDirective.params?.message;
  
  return { percent: isNaN(percent) ? 0 : percent, message };
}

/**
 * Extract focus area
 */
export function extractFocus(directives: DisplayDirective[]): FocusArea | null {
  const focusDirective = directives.find(d => d.type === 'focus');
  return focusDirective ? (focusDirective.value as FocusArea) : null;
}

/**
 * Check if directives contain hide command
 */
export function shouldHide(directives: DisplayDirective[]): boolean {
  return directives.some(d => d.type === 'hide');
}

/**
 * Extract TODO_ADD directives
 */
export function extractTodoAdd(directives: DisplayDirective[]): Array<{ category: string; description: string }> {
  return directives
    .filter(d => d.type === 'todo_add')
    .map(d => ({ category: d.value, description: d.params?.description || '' }))
    .filter(t => t.description);
}

/**
 * Extract TODO_COMPLETE directives
 */
export function extractTodoComplete(directives: DisplayDirective[]): string[] {
  return directives
    .filter(d => d.type === 'todo_complete')
    .map(d => d.value);
}

/**
 * Extract TODO_UPDATE directives
 */
export function extractTodoUpdate(directives: DisplayDirective[]): Array<{ taskId: string; description: string }> {
  return directives
    .filter(d => d.type === 'todo_update')
    .map(d => ({ taskId: d.value, description: d.params?.description || '' }))
    .filter(t => t.description);
}

/**
 * Parse DISPLAY_ARTIFACT directive into Artifact object
 * Format: [DISPLAY_ARTIFACT: type title="Title" content="Content" language="typescript"]
 */
export function parseArtifactDirective(text: string): Artifact | null {
  const artifactPattern = /\[DISPLAY_ARTIFACT:\s*(\w+)\s+([^\]]+)\]/gi;
  const match = artifactPattern.exec(text);
  
  if (!match) return null;
  
  const artifactType = match[1] as ArtifactType;
  if (!VALID_ARTIFACT_TYPES.includes(artifactType)) return null;
  
  const paramsText = match[2];
  const params: Record<string, string> = {};
  
  // Parse key="value" pairs
  const paramPattern = /(\w+)="([^"]+)"/g;
  let paramMatch;
  while ((paramMatch = paramPattern.exec(paramsText)) !== null) {
    params[paramMatch[1]] = paramMatch[2];
  }
  
  if (!params.title || !params.content) return null;
  
  return {
    type: artifactType,
    title: params.title,
    content: params.content,
    language: params.language,
  };
}

/**
 * Extract JSON from directive with balanced brace matching
 */
function extractJsonFromDirective(text: string, directiveName: string): string | null {
  const startPattern = new RegExp(`\\[${directiveName}:\\s*`, 'i');
  const startMatch = startPattern.exec(text);

  if (!startMatch) return null;

  let pos = startMatch.index + startMatch[0].length;
  if (text[pos] !== '{') return null;

  let braceCount = 0;
  let jsonStart = pos;

  while (pos < text.length) {
    const char = text[pos];
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;

    if (braceCount === 0) {
      // Found matching closing brace
      return text.substring(jsonStart, pos + 1);
    }
    pos++;
  }

  return null; // Unmatched braces
}

/**
 * Parse DISPLAY_CHART directive with embedded JSON data
 * Format: [DISPLAY_CHART: {...json...}]
 */
export function parseChartDirective(text: string): ChartData | null {
  const jsonStr = extractJsonFromDirective(text, 'DISPLAY_CHART');
  if (!jsonStr) return null;

  try {
    const data = JSON.parse(jsonStr);

    // Validate required fields
    if (!data.type || !data.title || !data.data) {
      console.warn('[Directive] DISPLAY_CHART missing required fields');
      return null;
    }

    // Generate ID if not provided
    if (!data.id) {
      data.id = `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    return data as ChartData;
  } catch (error) {
    console.warn('[Directive] Invalid DISPLAY_CHART JSON:', error);
    return null;
  }
}

/**
 * Parse DISPLAY_TABLE directive with embedded JSON data
 */
export function parseTableDirective(text: string): TableData | null {
  const jsonStr = extractJsonFromDirective(text, 'DISPLAY_TABLE');
  if (!jsonStr) return null;

  try {
    const data = JSON.parse(jsonStr);

    if (!data.columns || !data.rows) {
      console.warn('[Directive] DISPLAY_TABLE missing columns or rows');
      return null;
    }

    if (!data.id) {
      data.id = `table-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    return data as TableData;
  } catch (error) {
    console.warn('[Directive] Invalid DISPLAY_TABLE JSON:', error);
    return null;
  }
}

/**
 * Parse DISPLAY_METRICS directive
 */
export function parseMetricsDirective(text: string): MetricsData | null {
  const jsonStr = extractJsonFromDirective(text, 'DISPLAY_METRICS');
  if (!jsonStr) return null;

  try {
    const data = JSON.parse(jsonStr);

    if (!data.metrics || !Array.isArray(data.metrics)) {
      console.warn('[Directive] DISPLAY_METRICS missing metrics array');
      return null;
    }

    if (!data.id) {
      data.id = `metrics-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    return data as MetricsData;
  } catch (error) {
    console.warn('[Directive] Invalid DISPLAY_METRICS JSON:', error);
    return null;
  }
}

/**
 * Parse DISPLAY_CODE directive
 */
export function parseCodeDirective(text: string): CodeData | null {
  const jsonStr = extractJsonFromDirective(text, 'DISPLAY_CODE');
  if (!jsonStr) return null;

  try {
    const data = JSON.parse(jsonStr);

    if (!data.code || !data.language) {
      console.warn('[Directive] DISPLAY_CODE missing code or language');
      return null;
    }

    if (!data.id) {
      data.id = `code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    return data as CodeData;
  } catch (error) {
    console.warn('[Directive] Invalid DISPLAY_CODE JSON:', error);
    return null;
  }
}

/**
 * Parse UPDATE_CHART directive (for real-time updates)
 */
export function parseUpdateChartDirective(text: string): ChartUpdate | null {
  const jsonStr = extractJsonFromDirective(text, 'UPDATE_CHART');
  if (!jsonStr) return null;

  try {
    const update = JSON.parse(jsonStr);

    if (!update.id) {
      console.warn('[Directive] UPDATE_CHART missing id');
      return null;
    }

    return update as ChartUpdate;
  } catch (error) {
    console.warn('[Directive] Invalid UPDATE_CHART JSON:', error);
    return null;
  }
}

/**
 * Parse UPDATE_TABLE directive (for real-time updates)
 */
export function parseUpdateTableDirective(text: string): TableUpdate | null {
  const pattern = /\[UPDATE_TABLE:\s*(\{[\s\S]*?\})\]/gi;
  const match = pattern.exec(text);

  if (!match) return null;

  try {
    const update = JSON.parse(match[1]);

    if (!update.id) {
      console.warn('[Directive] UPDATE_TABLE missing id');
      return null;
    }

    return update as TableUpdate;
  } catch (error) {
    console.warn('[Directive] Invalid UPDATE_TABLE JSON:', error);
    return null;
  }
}

/**
 * Parse DISPLAY_NOTIFICATION directive
 */
export function parseNotificationDirective(text: string): NotificationData | null {
  const jsonStr = extractJsonFromDirective(text, 'DISPLAY_NOTIFICATION');
  if (!jsonStr) return null;

  try {
    return JSON.parse(jsonStr) as NotificationData;
  } catch (error) {
    console.warn('[Directive] Invalid DISPLAY_NOTIFICATION JSON:', error);
    return null;
  }
}
