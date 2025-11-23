/**
 * Trigger-Based Recall System
 *
 * Automatically surfaces memories when trigger keywords appear in conversation.
 * Prevents catastrophic forgetting by proactive injection.
 */

import { RecallEngine } from './RecallEngine';

interface TriggerRule {
  keywords: string[];
  memoryQuery: string;
  importance: number; // Minimum importance to surface
  protection_level?: number; // Only surface protected memories
}

// Trigger rules based on LESSONS_LEARNED.md
const TRIGGER_RULES: TriggerRule[] = [
  {
    keywords: ['spread', 'bid-ask', 'transaction cost', 'assume', 'typical'],
    memoryQuery: 'market data assumption spread cost verification',
    importance: 0.8,
    protection_level: 0, // Only CRITICAL lessons
  },
  {
    keywords: ['backtest', 'quick', 'simple', 'rough', 'approximate'],
    memoryQuery: 'backtest methodology shortcuts validation',
    importance: 0.8,
    protection_level: 0,
  },
  {
    keywords: ['overfitting', 'overfit', 'parameter', 'sensitivity'],
    memoryQuery: 'overfitting parameter sensitivity validation',
    importance: 0.7,
  },
  {
    keywords: ['regime', 'volatility', 'crash', '2020', 'regime 4'],
    memoryQuery: 'regime failure mode crash volatility',
    importance: 0.6,
  },
  {
    keywords: ['walk-forward', 'out of sample', 'validation'],
    memoryQuery: 'walk-forward validation failure oos',
    importance: 0.7,
  },
];

export class TriggerRecall {
  constructor(private recallEngine: RecallEngine) {}

  /**
   * Check message for trigger keywords and surface relevant memories
   */
  async checkTriggers(message: string, workspaceId: string): Promise<any[]> {
    const messageLower = message.toLowerCase();
    const triggeredMemories = new Map<string, any>();

    for (const rule of TRIGGER_RULES) {
      // Check if any trigger keyword matches
      const matched = rule.keywords.some((keyword) => messageLower.includes(keyword.toLowerCase()));

      if (matched) {
        // Recall relevant memories
        const result = await this.recallEngine.recall(rule.memoryQuery, workspaceId, {
          limit: 5,
          minImportance: rule.importance,
          useCache: true,
          rerank: false, // Fast retrieval for triggers
        });

        // Filter by protection level if specified
        let memories = result.memories;
        if (rule.protection_level !== undefined) {
          memories = memories.filter(m => {
            // Requires protection_level in memory result
            // For now, include all since RecallEngine doesn't return this field
            return true;  // TODO: Add protection_level to RecallEngine response
          });
        }

        // Add to triggered set (deduplicate by ID)
        for (const memory of memories) {
          if (!triggeredMemories.has(memory.id)) {
            triggeredMemories.set(memory.id, {
              ...memory,
              triggeredBy: rule.keywords.filter((k) => messageLower.includes(k.toLowerCase())),
            });
          }
        }
      }
    }

    const triggered = Array.from(triggeredMemories.values());

    if (triggered.length > 0) {
      console.log(
        `[TriggerRecall] Triggered ${triggered.length} memories for message: ${message.slice(0, 50)}...`
      );
    }

    return triggered;
  }

  /**
   * Format triggered memories for injection into prompt
   */
  formatTriggeredMemories(memories: any[]): string {
    if (memories.length === 0) return '';

    let formatted = '## ⚠️ CRITICAL MEMORIES AUTO-SURFACED (Trigger-Based)\n\n';
    formatted += '*These memories were automatically surfaced because trigger keywords appeared in the conversation.*\n\n';

    for (const memory of memories) {
      formatted += `### 🚨 ${memory.summary || 'Critical Lesson'}\n`;
      formatted += `**Triggered by:** ${memory.triggeredBy?.join(', ') || 'keyword match'}\n\n`;
      formatted += `${memory.content}\n\n`;
      formatted += `---\n\n`;
    }

    return formatted;
  }
}
