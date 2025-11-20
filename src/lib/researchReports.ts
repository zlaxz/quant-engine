/**
 * Research Report Utilities
 * 
 * Helpers for creating, formatting, and managing research reports
 * generated from /auto_analyze outputs.
 */

/**
 * Build a default report title based on scope and timestamp
 */
export function buildDefaultReportTitle(scope: string | null, createdAt: string): string {
  const date = new Date(createdAt).toISOString().split('T')[0]; // YYYY-MM-DD
  
  if (scope) {
    // Capitalize first letter and clean up scope
    const cleanScope = scope
      .replace(/^strategy:/i, '')
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    return `${cleanScope} Research – ${date}`;
  }
  
  return `Workspace Research Report – ${date}`;
}

/**
 * Extract executive summary from /auto_analyze report content
 * Falls back to first few lines if Executive Summary section not found
 */
export function extractSummaryFromReport(content: string): string {
  // Try to find Executive Summary section
  const execSummaryMatch = content.match(/(?:^|\n)#+\s*(?:1\.?\s*)?Executive Summary[:\s]*\n+([\s\S]+?)(?=\n#+|$)/i);
  
  if (execSummaryMatch && execSummaryMatch[1]) {
    const summary = execSummaryMatch[1].trim();
    // Take first paragraph or up to 500 chars
    const firstPara = summary.split('\n\n')[0];
    return firstPara.length > 500 ? firstPara.substring(0, 497) + '...' : firstPara;
  }
  
  // Fallback: take first 3-5 lines (skip empty lines)
  const lines = content
    .split('\n')
    .filter(line => line.trim().length > 0)
    .slice(0, 5)
    .join(' ');
  
  return lines.length > 500 ? lines.substring(0, 497) + '...' : lines;
}

/**
 * Build tags from scope and report content
 * Extracts strategy keys and scope terms
 */
export function buildTagsFromReport(scope: string | null, content: string): string[] {
  const tags = new Set<string>();
  
  // Add scope if provided
  if (scope) {
    // Clean and split scope
    const scopeTerms = scope
      .toLowerCase()
      .replace(/^strategy:/i, '')
      .split(/[\s,]+/)
      .filter(t => t.length > 0);
    
    scopeTerms.forEach(term => tags.add(term));
  }
  
  // Extract strategy keys from content (pattern: word_word_v#)
  const strategyPattern = /\b([a-z_]+_v\d+)\b/gi;
  const matches = content.matchAll(strategyPattern);
  
  for (const match of matches) {
    tags.add(match[1].toLowerCase());
  }
  
  // Extract common strategy terms
  const commonTerms = ['skew', 'momentum', 'volatility', 'vol', 'convexity', 'breakout', 'reversal'];
  const contentLower = content.toLowerCase();
  
  for (const term of commonTerms) {
    const regex = new RegExp(`\\b${term}\\b`, 'i');
    if (regex.test(contentLower)) {
      tags.add(term);
    }
  }
  
  // Convert to array and limit to 10 most relevant
  return Array.from(tags).slice(0, 10);
}
