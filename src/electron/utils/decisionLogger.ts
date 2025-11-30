/**
 * Decision Logger - Tracks routing decisions for pattern analysis
 * Logs every routing decision with reasoning, alternatives, and outcomes
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface RoutingDecision {
  id: string;
  timestamp: number;
  task: string;
  chosen: 'claude-code' | 'gemini-direct' | 'deepseek-swarm';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  alternativeConsidered?: string;
  reasoning: string;
  overridden?: boolean;
  overriddenTo?: string;
  outcome?: {
    success: boolean;
    duration: number;
    error?: string;
  };
  sessionId?: string;
  workspaceId?: string;
}

export class DecisionLogger {
  private logPath: string;
  private decisions: RoutingDecision[] = [];
  private maxLogSize = 1000; // Keep last 1000 decisions in memory

  constructor() {
    const userDataPath = app.getPath('userData');
    this.logPath = path.join(userDataPath, 'routing-decisions.jsonl');
    this.loadRecentDecisions();
  }

  /**
   * Load recent decisions from disk on startup
   */
  private loadRecentDecisions(): void {
    try {
      if (fs.existsSync(this.logPath)) {
        const lines = fs.readFileSync(this.logPath, 'utf-8').split('\n').filter(Boolean);
        // Load last 100 decisions
        const recentLines = lines.slice(-100);
        this.decisions = recentLines.map(line => JSON.parse(line));
      }
    } catch (error) {
      console.error('[DecisionLogger] Failed to load recent decisions:', error);
      this.decisions = [];
    }
  }

  /**
   * Log a new routing decision
   */
  logDecision(decision: Omit<RoutingDecision, 'id' | 'timestamp'>): RoutingDecision {
    const fullDecision: RoutingDecision = {
      ...decision,
      id: `dec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    // Add to in-memory cache
    this.decisions.push(fullDecision);
    if (this.decisions.length > this.maxLogSize) {
      this.decisions.shift(); // Remove oldest
    }

    // Append to disk (JSONL format - one JSON per line)
    try {
      fs.appendFileSync(this.logPath, JSON.stringify(fullDecision) + '\n');
    } catch (error) {
      console.error('[DecisionLogger] Failed to write decision:', error);
    }

    return fullDecision;
  }

  /**
   * Update decision with override information
   */
  logOverride(decisionId: string, overriddenTo: string): void {
    const decision = this.decisions.find(d => d.id === decisionId);
    if (decision) {
      decision.overridden = true;
      decision.overriddenTo = overriddenTo;
      
      // Rewrite file with updated decision
      try {
        const allLines = fs.readFileSync(this.logPath, 'utf-8').split('\n').filter(Boolean);
        const updatedLines = allLines.map(line => {
          const parsed = JSON.parse(line);
          if (parsed.id === decisionId) {
            return JSON.stringify({ ...parsed, overridden: true, overriddenTo });
          }
          return line;
        });
        fs.writeFileSync(this.logPath, updatedLines.join('\n') + '\n');
      } catch (error) {
        console.error('[DecisionLogger] Failed to update override:', error);
      }
    }
  }

  /**
   * Update decision with execution outcome
   */
  logOutcome(decisionId: string, outcome: RoutingDecision['outcome']): void {
    const decision = this.decisions.find(d => d.id === decisionId);
    if (decision) {
      decision.outcome = outcome;

      // Rewrite file with updated decision
      try {
        const allLines = fs.readFileSync(this.logPath, 'utf-8').split('\n').filter(Boolean);
        const updatedLines = allLines.map(line => {
          const parsed = JSON.parse(line);
          if (parsed.id === decisionId) {
            return JSON.stringify({ ...parsed, outcome });
          }
          return line;
        });
        fs.writeFileSync(this.logPath, updatedLines.join('\n') + '\n');
      } catch (error) {
        console.error('[DecisionLogger] Failed to update outcome:', error);
      }
    }
  }

  /**
   * Get recent decisions for display
   */
  getRecentDecisions(limit: number = 10): RoutingDecision[] {
    return this.decisions.slice(-limit).reverse();
  }

  /**
   * Get decisions for specific session
   */
  getSessionDecisions(sessionId: string): RoutingDecision[] {
    return this.decisions.filter(d => d.sessionId === sessionId).reverse();
  }

  /**
   * Get override rate (what % of decisions were overridden)
   */
  getOverrideRate(): number {
    if (this.decisions.length === 0) return 0;
    const overridden = this.decisions.filter(d => d.overridden).length;
    return (overridden / this.decisions.length) * 100;
  }

  /**
   * Get success rate by routing choice
   */
  getSuccessRate(choice: RoutingDecision['chosen']): number {
    const relevantDecisions = this.decisions.filter(
      d => d.chosen === choice && d.outcome !== undefined
    );
    if (relevantDecisions.length === 0) return 0;
    
    const successful = relevantDecisions.filter(d => d.outcome?.success).length;
    return (successful / relevantDecisions.length) * 100;
  }

  /**
   * Get average confidence by routing choice
   */
  getAverageConfidence(choice: RoutingDecision['chosen']): string {
    const relevantDecisions = this.decisions.filter(d => d.chosen === choice);
    if (relevantDecisions.length === 0) return 'N/A';

    const confidenceScores = relevantDecisions.map(d => {
      switch (d.confidence) {
        case 'HIGH': return 3;
        case 'MEDIUM': return 2;
        case 'LOW': return 1;
      }
    });

    const avg = confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;
    if (avg >= 2.5) return 'HIGH';
    if (avg >= 1.5) return 'MEDIUM';
    return 'LOW';
  }
}

// Singleton instance
let loggerInstance: DecisionLogger | null = null;

export function getDecisionLogger(): DecisionLogger {
  if (!loggerInstance) {
    loggerInstance = new DecisionLogger();
  }
  return loggerInstance;
}
