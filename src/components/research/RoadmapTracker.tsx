import { Card } from "@/components/ui/card";
import { useResearchDisplay, type TaskCategory } from "@/contexts/ResearchDisplayContext";
import { CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

const categoryIcons: Record<TaskCategory, string> = {
  'Analysis': '📊',
  'Backtesting': '🧪',
  'Code Review': '🔍',
  'Pattern Mining': '⛏️',
  'Memory Curation': '🧠',
  'Risk Review': '⚠️',
  'Experiment Planning': '🎯',
  'Data Inspection': '📈',
  'Documentation': '📝',
};

const categoryColors: Record<TaskCategory, string> = {
  'Analysis': 'text-blue-500',
  'Backtesting': 'text-purple-500',
  'Code Review': 'text-orange-500',
  'Pattern Mining': 'text-yellow-500',
  'Memory Curation': 'text-green-500',
  'Risk Review': 'text-red-500',
  'Experiment Planning': 'text-indigo-500',
  'Data Inspection': 'text-cyan-500',
  'Documentation': 'text-gray-500',
};

export const RoadmapTracker = () => {
  const { tasks, completeTask } = useResearchDisplay();

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4" />
        Research To-Do
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </h3>
      
      {tasks.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-6">
          No active tasks. Chief Quant will add tasks as work progresses.
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-2 p-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors group"
            >
              <span className={`text-sm shrink-0 ${categoryColors[task.category]}`}>
                {categoryIcons[task.category]}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-muted-foreground">
                  {task.category}
                </div>
                <div className="text-xs mt-0.5">{task.description}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={() => completeTask(task.id)}
                title="Mark as complete"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
