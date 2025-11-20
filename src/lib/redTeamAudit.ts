/**
 * Red Team Code Audit Orchestration
 * Runs multiple specialized auditors against rotation-engine code
 */

import { supabase } from '@/integrations/supabase/client';
import {
  buildStrategyLogicAuditPrompt,
  buildOverfitAuditPrompt,
  buildLookaheadBiasAuditPrompt,
  buildRobustnessAuditPrompt,
  buildConsistencyAuditPrompt,
} from '@/prompts/redTeamPrompts';
import { runSwarm, type SwarmPrompt } from '@/lib/swarmClient';

export interface SubReport {
  role: string;
  content: string;
}

export interface RedTeamAuditResult {
  report: string;
  subReports: SubReport[];
}

interface AuditorConfig {
  role: string;
  buildPrompt: (code: string, path: string, context: string) => string;
}

const AUDITORS: AuditorConfig[] = [
  {
    role: 'Strategy Logic Auditor',
    buildPrompt: buildStrategyLogicAuditPrompt,
  },
  {
    role: 'Overfit Auditor',
    buildPrompt: buildOverfitAuditPrompt,
  },
  {
    role: 'Lookahead Bias Auditor',
    buildPrompt: buildLookaheadBiasAuditPrompt,
  },
  {
    role: 'Robustness Auditor',
    buildPrompt: buildRobustnessAuditPrompt,
  },
  {
    role: 'Implementation Consistency Auditor',
    buildPrompt: buildConsistencyAuditPrompt,
  },
];

/**
 * Run multi-agent red team audit for a code file (v2: parallel + synthesis)
 */
export async function runRedTeamAuditForFile(params: {
  sessionId: string;
  workspaceId: string;
  path: string;
  code: string;
  context?: string;
}): Promise<RedTeamAuditResult> {
  const { sessionId, workspaceId, path, code, context = '' } = params;
  
  console.log(`Starting red team audit for ${path} (parallel execution)`);

  // STEP 1: Build all auditor prompts
  const prompts: SwarmPrompt[] = AUDITORS.map(auditor => ({
    label: auditor.role,
    content: auditor.buildPrompt(code, path, context),
  }));

  console.log(`Built ${prompts.length} auditor prompts, executing in parallel...`);

  // STEP 2: Run all auditors in parallel via swarm
  let results;
  try {
    results = await runSwarm({
      sessionId,
      workspaceId,
      prompts,
    });
  } catch (err: any) {
    console.error('Swarm execution failed:', err);
    throw new Error(`Red team audit failed: ${err.message}`);
  }

  console.log(`Parallel execution complete, received ${results.length} results`);

  // STEP 3: Build sub-reports from swarm results
  const subReports: SubReport[] = [];
  const reportSections: string[] = [];

  for (const result of results) {
    if (result.error) {
      const failureContent = `❌ ${result.label} failed: ${result.error}`;
      subReports.push({
        role: result.label,
        content: failureContent,
      });
      reportSections.push(`### ${result.label}\n\n${failureContent}\n`);
    } else {
      subReports.push({
        role: result.label,
        content: result.content,
      });
      reportSections.push(`### ${result.label}\n\n${result.content}\n`);
    }
  }

  // STEP 4: Synthesize all sub-reports into final report via chat-primary
  console.log('Synthesizing final report via chat-primary...');
  
  const synthesisPrompt = `You are synthesizing a Red Team Code Audit Report.

**File:** ${path}
${context ? `**Context:** ${context}\n` : ''}

You have received ${subReports.length} specialized auditor reports for this code file.
Each auditor examined the code from a different perspective.

Your task:
1. Review all auditor findings below.
2. Synthesize them into a coherent, actionable Code Audit Report.
3. Structure: Executive Summary, Critical Issues, Moderate Issues, Minor Issues, Recommendations.
4. Be concise, evidence-based, and actionable.
5. Highlight the most important findings first.

---

${reportSections.join('\n---\n\n')}

---

Now synthesize this into a final Code Audit Report.`;

  let synthesizedReport = '';
  
  try {
    const { data, error } = await supabase.functions.invoke('chat-primary', {
      body: {
        sessionId,
        workspaceId,
        content: synthesisPrompt,
      },
    });

    if (error) {
      console.error('Synthesis failed:', error);
      synthesizedReport = `⚠️ Synthesis failed: ${error.message}\n\nFalling back to raw sub-reports:\n\n${reportSections.join('\n---\n\n')}`;
    } else {
      // Extract synthesized content
      if (data && typeof data === 'object') {
        synthesizedReport = data.content || data.message || '';
      } else if (typeof data === 'string') {
        synthesizedReport = data;
      }
      
      if (!synthesizedReport) {
        synthesizedReport = `⚠️ Synthesis returned empty content.\n\nFalling back to raw sub-reports:\n\n${reportSections.join('\n---\n\n')}`;
      }
    }
  } catch (err: any) {
    console.error('Synthesis exception:', err);
    synthesizedReport = `⚠️ Synthesis exception: ${err.message}\n\nFalling back to raw sub-reports:\n\n${reportSections.join('\n---\n\n')}`;
  }

  console.log('Red team audit complete');

  return {
    report: synthesizedReport,
    subReports,
  };
}
