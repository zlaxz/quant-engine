/**
 * MemoryScribe - The Institutional Chronicler
 *
 * Bridges Supabase events to Obsidian documentation.
 * Watches for strategy graduations/failures and mission completions,
 * then documents them narratively in Obsidian for institutional memory.
 *
 * The Python Daemon learns mathematically from failures (causal_memories),
 * this Scribe documents them narratively for human review.
 */

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { getMCPManager, MCPClientManager } from '../mcp/MCPClientManager';

interface StrategyGenomeRow {
  id: string;
  name: string;
  status: string;
  code_content?: string;
  dna_config?: Record<string, unknown>;
  fitness_score?: number;
  sharpe_ratio?: number;
  sortino_ratio?: number;
  max_drawdown?: number;
  win_rate?: number;
  generation?: number;
  parent_id?: string;
  created_at?: string;
  updated_at?: string;
  failure_reason?: string;
  notes?: string;
}

interface MissionRow {
  id: string;
  name: string;
  objective?: string;
  target_metric: string;
  target_value: number;
  target_operator: string;
  status: string;
  current_best_value?: number;
  current_best_strategy_id?: string;
  created_at?: string;
  completed_at?: string;
  notes?: string;
}

// Status icons for Obsidian filenames
const STATUS_ICONS: Record<string, string> = {
  graduated: '🎓',
  active: '✅',
  shadow: '👻',
  incubating: '🥚',
  failed: '❌',
  retired: '📦',
  complete: '🏆',
  in_progress: '🔄',
  paused: '⏸️'
};

export class MemoryScribe {
  private supabase: SupabaseClient | null = null;
  private mcp: MCPClientManager;
  private strategyChannel: RealtimeChannel | null = null;
  private missionChannel: RealtimeChannel | null = null;
  private isWatching = false;

  constructor(vaultPath: string = '/Users/zstoc/ObsidianVault') {
    this.mcp = getMCPManager(vaultPath);
  }

  /**
   * Initialize Supabase client for Realtime subscriptions
   */
  private initSupabase(): boolean {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[Scribe] Supabase credentials not found');
      return false;
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Scribe] Supabase client initialized');
    return true;
  }

  /**
   * Start watching for database events
   */
  async startWatching(): Promise<boolean> {
    if (this.isWatching) {
      console.log('[Scribe] Already watching');
      return true;
    }

    // Initialize Supabase
    if (!this.supabase && !this.initSupabase()) {
      return false;
    }

    // Connect to Obsidian MCP
    const obsidianConnected = await this.mcp.connectObsidian();
    if (!obsidianConnected) {
      console.error('[Scribe] Failed to connect to Obsidian MCP');
      return false;
    }

    try {
      // Subscribe to strategy_genome updates
      this.strategyChannel = this.supabase!
        .channel('strategy-scribe')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'strategy_genome'
          },
          (payload) => this.handleStrategyUpdate(payload.new as StrategyGenomeRow, payload.old as StrategyGenomeRow)
        )
        .subscribe((status) => {
          console.log(`[Scribe] Strategy channel status: ${status}`);
        });

      // Subscribe to missions updates
      this.missionChannel = this.supabase!
        .channel('mission-scribe')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'missions'
          },
          (payload) => this.handleMissionUpdate(payload.new as MissionRow, payload.old as MissionRow)
        )
        .subscribe((status) => {
          console.log(`[Scribe] Mission channel status: ${status}`);
        });

      this.isWatching = true;
      console.log('[Scribe] Now watching strategy_genome and missions tables');
      return true;

    } catch (error) {
      console.error('[Scribe] Failed to start watching:', error);
      return false;
    }
  }

  /**
   * Stop watching for database events
   */
  async stopWatching(): Promise<void> {
    if (this.strategyChannel) {
      await this.supabase?.removeChannel(this.strategyChannel);
      this.strategyChannel = null;
    }
    if (this.missionChannel) {
      await this.supabase?.removeChannel(this.missionChannel);
      this.missionChannel = null;
    }
    this.isWatching = false;
    console.log('[Scribe] Stopped watching');
  }

  /**
   * Handle strategy_genome UPDATE events
   */
  private async handleStrategyUpdate(
    newRow: StrategyGenomeRow,
    oldRow: StrategyGenomeRow
  ): Promise<void> {
    // Only document status changes (graduated, failed, etc.)
    if (newRow.status === oldRow.status) {
      return;
    }

    console.log(`[Scribe] Strategy status changed: ${oldRow.status} -> ${newRow.status} (${newRow.name})`);

    // Document graduated or failed strategies
    if (newRow.status === 'graduated' || newRow.status === 'failed') {
      await this.writeStrategyCard(newRow);
    }
  }

  /**
   * Handle missions UPDATE events
   */
  private async handleMissionUpdate(
    newRow: MissionRow,
    oldRow: MissionRow
  ): Promise<void> {
    // Only document completed missions
    if (newRow.status === 'complete' && oldRow.status !== 'complete') {
      console.log(`[Scribe] Mission completed: ${newRow.name}`);
      await this.writeMissionLog(newRow);
    }
  }

  /**
   * Write a strategy card to Obsidian
   */
  async writeStrategyCard(strategy: StrategyGenomeRow): Promise<boolean> {
    const icon = STATUS_ICONS[strategy.status] || '📄';
    const filename = `${icon} ${this.sanitizeFilename(strategy.name)}.md`;
    const path = `Projects/quant-engine/06-Strategies/${filename}`;

    const frontmatter = this.buildFrontmatter({
      strategy_id: strategy.id,
      status: strategy.status,
      fitness_score: strategy.fitness_score,
      sharpe_ratio: strategy.sharpe_ratio,
      sortino_ratio: strategy.sortino_ratio,
      max_drawdown: strategy.max_drawdown,
      win_rate: strategy.win_rate,
      generation: strategy.generation,
      created_at: strategy.created_at,
      updated_at: strategy.updated_at
    });

    const content = `${frontmatter}
# ${icon} ${strategy.name}

**Status:** ${strategy.status.toUpperCase()}
**Generation:** ${strategy.generation || 0}
**Created:** ${strategy.created_at ? new Date(strategy.created_at).toLocaleDateString() : 'Unknown'}

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Fitness Score | ${strategy.fitness_score?.toFixed(4) || 'N/A'} |
| Sharpe Ratio | ${strategy.sharpe_ratio?.toFixed(2) || 'N/A'} |
| Sortino Ratio | ${strategy.sortino_ratio?.toFixed(2) || 'N/A'} |
| Max Drawdown | ${strategy.max_drawdown ? (strategy.max_drawdown * 100).toFixed(2) + '%' : 'N/A'} |
| Win Rate | ${strategy.win_rate ? (strategy.win_rate * 100).toFixed(1) + '%' : 'N/A'} |

---

## Configuration

\`\`\`json
${JSON.stringify(strategy.dna_config || {}, null, 2)}
\`\`\`

---

${strategy.status === 'failed' ? `## Failure Analysis

**Reason:** ${strategy.failure_reason || 'Unknown'}

${strategy.notes || '_No additional notes._'}

---

` : ''}## Code

\`\`\`python
${strategy.code_content || '# No code available'}
\`\`\`

---

*Documented by MemoryScribe on ${new Date().toISOString()}*
`;

    try {
      const result = await this.mcp.obsidianWriteNote(path, content);
      if (result.success) {
        console.log(`[Scribe] ✅ Wrote strategy card: ${path}`);
        return true;
      } else {
        console.error(`[Scribe] ❌ Failed to write strategy card: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error('[Scribe] Error writing strategy card:', error);
      return false;
    }
  }

  /**
   * Write a mission log to Obsidian
   */
  async writeMissionLog(mission: MissionRow): Promise<boolean> {
    const icon = STATUS_ICONS[mission.status] || '📋';
    const filename = `${icon} ${this.sanitizeFilename(mission.name)}.md`;
    const path = `Projects/quant-engine/09-Missions/${filename}`;

    const frontmatter = this.buildFrontmatter({
      mission_id: mission.id,
      status: mission.status,
      target_metric: mission.target_metric,
      target_value: mission.target_value,
      target_operator: mission.target_operator,
      achieved_value: mission.current_best_value,
      winning_strategy: mission.current_best_strategy_id,
      created_at: mission.created_at,
      completed_at: mission.completed_at
    });

    const targetDescription = `${mission.target_metric} ${mission.target_operator} ${mission.target_value}`;
    const content = `${frontmatter}
# ${icon} ${mission.name}

**Status:** ${mission.status.toUpperCase()}
**Target:** ${targetDescription}
**Achieved:** ${mission.current_best_value?.toFixed(4) || 'N/A'}

---

## Objective

${mission.objective || '_No objective specified._'}

---

## Results

| Metric | Target | Achieved |
|--------|--------|----------|
| ${mission.target_metric} | ${mission.target_operator} ${mission.target_value} | ${mission.current_best_value?.toFixed(4) || 'N/A'} |

${mission.current_best_strategy_id ? `
**Winning Strategy:** \`${mission.current_best_strategy_id}\`
` : ''}

---

## Timeline

- **Created:** ${mission.created_at ? new Date(mission.created_at).toLocaleDateString() : 'Unknown'}
- **Completed:** ${mission.completed_at ? new Date(mission.completed_at).toLocaleDateString() : 'Unknown'}

---

## Notes

${mission.notes || '_No additional notes._'}

---

*Documented by MemoryScribe on ${new Date().toISOString()}*
`;

    try {
      const result = await this.mcp.obsidianWriteNote(path, content);
      if (result.success) {
        console.log(`[Scribe] ✅ Wrote mission log: ${path}`);
        return true;
      } else {
        console.error(`[Scribe] ❌ Failed to write mission log: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error('[Scribe] Error writing mission log:', error);
      return false;
    }
  }

  /**
   * Build YAML frontmatter for Obsidian
   */
  private buildFrontmatter(data: Record<string, unknown>): string {
    const lines = ['---'];
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        if (typeof value === 'object') {
          lines.push(`${key}: ${JSON.stringify(value)}`);
        } else {
          lines.push(`${key}: ${value}`);
        }
      }
    }
    lines.push('---\n');
    return lines.join('\n');
  }

  /**
   * Sanitize filename for Obsidian compatibility
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  /**
   * Get current watching status
   */
  isActive(): boolean {
    return this.isWatching;
  }
}

// Singleton instance
let scribeInstance: MemoryScribe | null = null;

export function getMemoryScribe(vaultPath?: string): MemoryScribe {
  if (!scribeInstance) {
    scribeInstance = new MemoryScribe(vaultPath);
  }
  return scribeInstance;
}

export async function initializeMemoryScribe(vaultPath?: string): Promise<MemoryScribe> {
  const scribe = getMemoryScribe(vaultPath);
  await scribe.startWatching();
  return scribe;
}
