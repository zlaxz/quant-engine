import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Plus, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Workspace {
  id: string;
  name: string;
  description: string | null;
}

export const WorkspaceSelector = () => {
  const [_workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const { state } = useSidebar();

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

  const isCollapsed = state === 'collapsed';

  return (
    <TooltipProvider>
      <div className="p-3 border-b border-panel-border">
        <div className="flex items-center justify-between mb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarTrigger />
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        
        {!isCollapsed && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono uppercase text-muted-foreground tracking-wider">
                Workspace
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-6 w-6">
                    <Plus className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Create new workspace</p>
                </TooltipContent>
              </Tooltip>
            </div>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline" 
                  className="w-full justify-between font-mono text-sm"
                >
                  {selectedWorkspace?.name || 'No workspace'}
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{selectedWorkspace?.name || 'No workspace selected'}</p>
              </TooltipContent>
            </Tooltip>
            
            {selectedWorkspace?.description && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {selectedWorkspace.description}
              </p>
            )}
          </>
        )}
        
        {isCollapsed && selectedWorkspace && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center justify-center py-2">
                <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-xs font-mono font-semibold text-primary">
                  {selectedWorkspace.name.charAt(0).toUpperCase()}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{selectedWorkspace.name}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
};
