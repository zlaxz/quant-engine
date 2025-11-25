// Memory curation helpers for analyzing and improving the knowledge base

import type { MemoryNote } from '@/types/memory';

/**
 * Group memory notes by strategy tag
 * Returns a map with strategy keys and a "global" category for untagged notes
 */
export function groupMemoryByStrategy(notes: MemoryNote[]): Map<string, MemoryNote[]> {
  const groups = new Map<string, MemoryNote[]>();
  groups.set('global', []);

  for (const note of notes) {
    let assigned = false;
    
    // Check if any tag looks like a strategy key (contains underscores or 'v' pattern)
    for (const tag of note.tags || []) {
      if (tag.includes('_') || /v\d+/.test(tag)) {
        if (!groups.has(tag)) {
          groups.set(tag, []);
        }
        groups.get(tag)!.push(note);
        assigned = true;
      }
    }
    
    // If no strategy tag found, add to global
    if (!assigned) {
      groups.get('global')!.push(note);
    }
  }

  return groups;
}

/**
 * Find insights that should be promoted to rules
 * Criteria: insights with high importance or frequent similar content
 */
export function findPromotionCandidates(notes: MemoryNote[]): MemoryNote[] {
  const candidates: MemoryNote[] = [];
  
  for (const note of notes) {
    // Skip if already a rule or warning
    if (note.memory_type === 'rule' || note.memory_type === 'warning') {
      continue;
    }
    
    // Promote high-importance insights
    if (note.memory_type === 'insight' && note.importance === 'high') {
      candidates.push(note);
      continue;
    }
    
    // Promote insights linked to multiple runs
    if (note.run_id && note.tags && note.tags.length > 2) {
      candidates.push(note);
    }
  }
  
  return candidates;
}

/**
 * Find rules that lack supporting evidence or are old without references
 */
export function findWeakRules(notes: MemoryNote[]): MemoryNote[] {
  const weak: MemoryNote[] = [];
  const rules = notes.filter(n => n.memory_type === 'rule' || n.memory_type === 'warning');
  
  for (const rule of rules) {
    // Check if rule is not linked to any runs
    const hasRunEvidence = rule.run_id !== null;
    
    // Check if rule has low importance but is marked as a rule
    const isLowImportance = rule.importance === 'low' || rule.importance === 'normal';
    
    // Check if rule is old (> 90 days) without high/critical importance
    const createdDate = rule.created_at ? new Date(rule.created_at) : new Date();
    const daysOld = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
    const isOldAndNotCritical = daysOld > 90 && rule.importance !== 'critical' && rule.importance !== 'high';
    
    if (!hasRunEvidence && isLowImportance) {
      weak.push(rule);
    } else if (isOldAndNotCritical && !hasRunEvidence) {
      weak.push(rule);
    }
  }
  
  return weak;
}

/**
 * Find conflicting rules (simple heuristic-based detection)
 */
export function findConflicts(notes: MemoryNote[]): { ruleA: MemoryNote; ruleB: MemoryNote }[] {
  const conflicts: { ruleA: MemoryNote; ruleB: MemoryNote }[] = [];
  const rules = notes.filter(n => n.memory_type === 'rule' || n.memory_type === 'warning');
  
  // Simple keyword-based conflict detection
  const opposites = [
    ['use', 'avoid'],
    ['increase', 'decrease'],
    ['high', 'low'],
    ['good', 'bad'],
    ['works', 'fails'],
    ['effective', 'ineffective']
  ];
  
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const ruleA = rules[i];
      const ruleB = rules[j];
      
      // Check if they share tags (same domain)
      const tagsA = ruleA.tags || [];
      const tagsB = ruleB.tags || [];
      const sharedTags = tagsA.filter(t => tagsB.includes(t));
      if (sharedTags.length === 0) continue;
      
      // Check for opposite keywords
      const contentA = ruleA.content.toLowerCase();
      const contentB = ruleB.content.toLowerCase();
      
      for (const [word1, word2] of opposites) {
        if ((contentA.includes(word1) && contentB.includes(word2)) ||
            (contentA.includes(word2) && contentB.includes(word1))) {
          conflicts.push({ ruleA, ruleB });
          break;
        }
      }
    }
  }
  
  return conflicts;
}

/**
 * Build a comprehensive summary for curation
 */
export function buildCurationSummary(notes: MemoryNote[]): string {
  if (notes.length === 0) {
    return "No memory notes available for curation.";
  }
  
  const grouped = groupMemoryByStrategy(notes);
  const promotions = findPromotionCandidates(notes);
  const weak = findWeakRules(notes);
  const conflicts = findConflicts(notes);
  
  let summary = "=== CURRENT MEMORY STATE ===\n\n";
  
  // Current rules grouped by strategy
  summary += "## CURRENT RULES BY STRATEGY\n\n";
  for (const [strategy, strategyNotes] of grouped.entries()) {
    const rules = strategyNotes.filter(n => n.memory_type === 'rule' || n.memory_type === 'warning');
    if (rules.length === 0) continue;
    
    summary += `### ${strategy.toUpperCase()}\n`;
    for (const rule of rules) {
      const importance = rule.importance || 'normal';
      const tags = rule.tags || [];
      summary += `- [${importance.toUpperCase()}] ${rule.content.slice(0, 100)}${rule.content.length > 100 ? '...' : ''}\n`;
      summary += `  ID: ${rule.id} | Tags: ${tags.join(', ')} | Run-linked: ${rule.run_id ? 'Yes' : 'No'}\n`;
    }
    summary += "\n";
  }
  
  // Promotion candidates
  if (promotions.length > 0) {
    summary += "## PROMOTION CANDIDATES (Insights → Rules)\n\n";
    for (const candidate of promotions) {
      const importance = candidate.importance || 'normal';
      const tags = candidate.tags || [];
      summary += `- [${importance.toUpperCase()}] ${candidate.content.slice(0, 100)}${candidate.content.length > 100 ? '...' : ''}\n`;
      summary += `  ID: ${candidate.id} | Tags: ${tags.join(', ')} | Run: ${candidate.run_id || 'none'}\n`;
      summary += `  Reason: ${candidate.importance === 'high' ? 'High importance insight' : 'Multiple tags/run-linked'}\n\n`;
    }
  } else {
    summary += "## PROMOTION CANDIDATES\nNone identified.\n\n";
  }
  
  // Weak rules
  if (weak.length > 0) {
    summary += "## WEAK RULES (Consider Demotion/Archive)\n\n";
    for (const rule of weak) {
      const createdAt = rule.created_at ? new Date(rule.created_at) : new Date();
      const age = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      const importance = rule.importance || 'normal';
      summary += `- [${importance.toUpperCase()}] ${rule.content.slice(0, 100)}${rule.content.length > 100 ? '...' : ''}\n`;
      summary += `  ID: ${rule.id} | Age: ${age} days | Run-linked: ${rule.run_id ? 'Yes' : 'No'}\n`;
      summary += `  Reason: ${!rule.run_id ? 'No run evidence' : 'Old without high importance'}\n\n`;
    }
  } else {
    summary += "## WEAK RULES\nNone identified.\n\n";
  }
  
  // Conflicts
  if (conflicts.length > 0) {
    summary += "## POTENTIAL CONFLICTS\n\n";
    for (const { ruleA, ruleB } of conflicts) {
      summary += `- CONFLICT:\n`;
      summary += `  Rule A [${ruleA.id}]: ${ruleA.content.slice(0, 80)}...\n`;
      summary += `  Rule B [${ruleB.id}]: ${ruleB.content.slice(0, 80)}...\n`;
      summary += `  Shared tags: ${(ruleA.tags || []).filter(t => (ruleB.tags || []).includes(t)).join(', ')}\n\n`;
    }
  } else {
    summary += "## CONFLICTS\nNone detected.\n\n";
  }
  
  summary += `\n=== TOTAL NOTES: ${notes.length} | RULES: ${notes.filter(n => n.memory_type === 'rule' || n.memory_type === 'warning').length} | INSIGHTS: ${notes.filter(n => n.memory_type === 'insight').length} ===`;
  
  return summary;
}
