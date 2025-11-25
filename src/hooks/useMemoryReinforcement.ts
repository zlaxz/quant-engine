import { useEffect, useState } from 'react';
import { useChatContext } from '@/contexts/ChatContext';
import { useToast } from '@/hooks/use-toast';

interface StaleMemory {
  id: string;
  content: string;
  summary: string;
  protection_level: number;
  financial_impact: number | null;
  last_recalled_at: string | null;
  days_since_recall: number;
}

export function useMemoryReinforcement() {
  const { selectedWorkspaceId } = useChatContext();
  const { toast } = useToast();
  const [staleMemories, setStaleMemories] = useState<StaleMemory[]>([]);

  useEffect(() => {
    // LOVABLE FIX: Skip if not running in Electron (browser mode)
    if (!selectedWorkspaceId || !window.electron?.getStaleMemories) {
      return;
    }

    const checkStaleMemories = async () => {
      try {
        const result = await window.electron.getStaleMemories(selectedWorkspaceId);
        if (result && Array.isArray(result) && result.length > 0) {
          setStaleMemories(result);
          toast({
            title: '🧠 Memory Reinforcement',
            description: `${result.length} critical lessons require review`,
          });
        }
      } catch (err) {
        console.error('[MemoryReinforcement] Failed:', err);
      }
    };

    // Check on mount and every 5 minutes
    checkStaleMemories();
    const interval = setInterval(checkStaleMemories, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedWorkspaceId, toast]);

  return { staleMemories };
}
