import { ipcMain } from "electron";
import { createClient } from "@supabase/supabase-js";
import { PatternDetector } from "../../lib/patternDetection";

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

export function setupPatternHandlers() {
  const supabase = createClient(supabaseUrl, supabaseKey);

  /**
   * Analyze recent backtest history to detect repeated failure patterns
   */
  ipcMain.handle(
    "pattern:detect",
    async (
      _event,
      { workspaceId, context }: { workspaceId: string; context: string }
    ) => {
      try {
        // Fetch recent backtest runs (last 10)
        const { data: runs, error } = await supabase
          .from("backtest_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(10);

        if (error) throw error;

        if (!runs || runs.length === 0) {
          return { pattern: null, confidence: 0 };
        }

        // Detect patterns
        const result = await PatternDetector.detectPattern(runs, context);

        // Store detected pattern if confidence is high
        if (result.pattern && result.confidence > 0.7) {
          await supabase.from("memories").insert({
            workspace_id: workspaceId,
            memory_type: "pattern",
            content: JSON.stringify(result.pattern),
            summary: result.pattern.title,
            importance_score: result.confidence,
            category: "user_pattern",
            tags: [result.pattern.patternType, "contextual_education"],
          });
        }

        return result;
      } catch (error) {
        console.error("[Pattern Detection] Error:", error);
        throw error;
      }
    }
  );

  /**
   * Get user's historical patterns
   */
  ipcMain.handle(
    "pattern:get-history",
    async (_event, { workspaceId }: { workspaceId: string }) => {
      try {
        const { data, error } = await supabase
          .from("memories")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("memory_type", "pattern")
          .order("created_at", { ascending: false })
          .limit(20);

        if (error) throw error;

        return (
          data?.map((mem) => ({
            ...JSON.parse(mem.content),
            storedAt: mem.created_at,
          })) || []
        );
      } catch (error) {
        console.error("[Pattern History] Error:", error);
        throw error;
      }
    }
  );

  /**
   * Dismiss a pattern (mark as acknowledged)
   */
  ipcMain.handle(
    "pattern:dismiss",
    async (_event, { patternId }: { patternId: string }) => {
      try {
        // Update pattern memory with dismissal timestamp
        const { error } = await supabase
          .from("memories")
          .update({
            tags: ["dismissed", "contextual_education"],
            updated_at: new Date().toISOString(),
          })
          .eq("id", patternId);

        if (error) throw error;
        return { success: true };
      } catch (error) {
        console.error("[Pattern Dismiss] Error:", error);
        throw error;
      }
    }
  );
}
