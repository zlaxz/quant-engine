import { DisplayDirective, ResearchStage, VisualizationType, FocusArea } from '@/types/journey';

/**
 * Parse display directives from Chief Quant responses
 * 
 * Directive formats:
 * [STAGE: regime_mapping]
 * [DISPLAY: regime_timeline from=2020-01-01 to=2024-12-31]
 * [PROGRESS: 45 message="Classifying Q2 2021"]
 * [FOCUS: center]
 * [HIDE]
 */
export function parseDisplayDirectives(text: string): DisplayDirective[] {
  const directives: DisplayDirective[] = [];
  
  // Pattern: [DIRECTIVE: value param1=val1 param2=val2]
  const directivePattern = /\[(\w+):?\s*([^\]]+)?\]/g;
  
  let match;
  while ((match = directivePattern.exec(text)) !== null) {
    const directiveType = match[1].toLowerCase();
    const directiveValue = match[2]?.trim() || '';
    
    if (directiveType === 'stage') {
      directives.push({
        type: 'stage',
        value: directiveValue as ResearchStage,
      });
    } else if (directiveType === 'display') {
      const { value, params } = parseDirectiveValue(directiveValue);
      directives.push({
        type: 'display',
        value: value as VisualizationType,
        params,
      });
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
      directives.push({
        type: 'focus',
        value: directiveValue as FocusArea,
      });
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
 */
export function stripDisplayDirectives(text: string): string {
  return text.replace(/\[(\w+):?\s*([^\]]+)?\]/g, '').trim();
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
