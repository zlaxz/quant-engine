/**
 * Findings Storage - Persist findings to localStorage
 */

import { Finding } from '@/types/findings';

const FINDINGS_STORAGE_KEY = 'quantos_findings';
const MAX_FINDINGS = 100; // Keep most recent 100 findings

export function loadFindings(): Finding[] {
  try {
    const stored = localStorage.getItem(FINDINGS_STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as Finding[];
  } catch (error) {
    console.error('Failed to load findings:', error);
    return [];
  }
}

export function saveFindings(findings: Finding[]): void {
  try {
    // Keep only the most recent MAX_FINDINGS
    const trimmed = findings
      .sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime())
      .slice(0, MAX_FINDINGS);
    
    localStorage.setItem(FINDINGS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Failed to save findings:', error);
  }
}

export function addFinding(finding: Omit<Finding, 'id' | 'discoveredAt'>): Finding {
  const newFinding: Finding = {
    ...finding,
    id: `finding_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    discoveredAt: new Date().toISOString(),
  };

  const findings = loadFindings();
  findings.unshift(newFinding);
  saveFindings(findings);
  
  return newFinding;
}

export function removeFinding(id: string): void {
  const findings = loadFindings();
  const updated = findings.filter(f => f.id !== id);
  saveFindings(updated);
}

export function clearAllFindings(): void {
  localStorage.removeItem(FINDINGS_STORAGE_KEY);
}
