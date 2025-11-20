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
 * Run multi-agent red team audit for a code file
 */
export async function runRedTeamAuditForFile(params: {
  sessionId: string;
  workspaceId: string;
  path: string;
  code: string;
  context?: string;
}): Promise<RedTeamAuditResult> {
  const { sessionId, workspaceId, path, code, context = '' } = params;
  
  const subReports: SubReport[] = [];
  const reportSections: string[] = [];

  console.log(`Starting red team audit for ${path}`);

  // Run each auditor sequentially
  for (const auditor of AUDITORS) {
    console.log(`Running ${auditor.role}...`);
    
    try {
      // Build auditor-specific prompt
      const prompt = auditor.buildPrompt(code, path, context);

      // Call chat edge function as this auditor
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          sessionId,
          workspaceId,
          content: prompt,
        },
      });

      if (error) {
        console.error(`${auditor.role} failed:`, error);
        const failureContent = `❌ ${auditor.role} failed: ${error.message}`;
        subReports.push({
          role: auditor.role,
          content: failureContent,
        });
        reportSections.push(`### ${auditor.role}\n\n${failureContent}\n`);
        continue;
      }

      // Extract assistant's response from the returned messages
      // The chat function returns the updated message history
      let auditContent = 'No response received';
      
      if (data && data.messages && Array.isArray(data.messages)) {
        // Get the last assistant message
        const lastAssistant = data.messages
          .filter((m: any) => m.role === 'assistant')
          .pop();
        
        if (lastAssistant) {
          auditContent = lastAssistant.content;
        }
      } else if (data && typeof data === 'string') {
        auditContent = data;
      } else if (data && data.content) {
        auditContent = data.content;
      }

      subReports.push({
        role: auditor.role,
        content: auditContent,
      });

      reportSections.push(`### ${auditor.role}\n\n${auditContent}\n`);
      
      console.log(`${auditor.role} completed`);
      
      // Small delay between auditors to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (err: any) {
      console.error(`${auditor.role} exception:`, err);
      const errorContent = `❌ ${auditor.role} threw exception: ${err.message}`;
      subReports.push({
        role: auditor.role,
        content: errorContent,
      });
      reportSections.push(`### ${auditor.role}\n\n${errorContent}\n`);
    }
  }

  // Combine all sections into final report
  const report = `# Red Team Code Audit Report
**File:** ${path}
${context ? `**Context:** ${context}\n` : ''}
**Auditors:** ${AUDITORS.length}

---

${reportSections.join('\n---\n\n')}

---

## Summary
This multi-agent red team audit examined the code from ${AUDITORS.length} specialized perspectives:
- Strategy logic and correctness
- Overfitting and brittleness
- Lookahead bias and data leakage
- Robustness and edge cases
- Implementation consistency

All findings are advisory. No code has been modified automatically.`;

  return {
    report,
    subReports,
  };
}
