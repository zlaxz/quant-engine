import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Plus, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

interface Workspace {
  id: string;
  name: string;
  description: string | null;
}

export const WorkspaceSelector = () => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const { data, error } = await supabase
        .from('workspaces')
        .select('id, name, description')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setWorkspaces(data || []);
      if (data && data.length > 0) {
        setSelectedWorkspace(data[0]);
      }
    } catch (error) {
      console.error('Error loading workspaces:', error);
      toast.error('Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 border-b border-panel-border">
        <div className="h-10 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="p-3 border-b border-panel-border">
      <div className="flex items-center justify-between mb-3">
        <SidebarTrigger />
      </div>
      
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono uppercase text-muted-foreground tracking-wider">
          Workspace
        </span>
        <Button size="icon" variant="ghost" className="h-6 w-6">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      
      <Button 
        variant="outline" 
        className="w-full justify-between font-mono text-sm"
      >
        {selectedWorkspace?.name || 'No workspace'}
        <ChevronDown className="h-4 w-4 ml-2" />
      </Button>
      
      {selectedWorkspace?.description && (
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {selectedWorkspace.description}
        </p>
      )}
    </div>
  );
};
