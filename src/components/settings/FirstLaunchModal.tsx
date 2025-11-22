import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FolderOpen, FolderPlus } from 'lucide-react';
import { toast } from 'sonner';

interface FirstLaunchModalProps {
  open: boolean;
  onComplete: () => void;
}

export function FirstLaunchModal({ open, onComplete }: FirstLaunchModalProps) {
  const [isCreating, setIsCreating] = useState(false);

  const handleBrowse = async () => {
    try {
      if (!window.electron?.pickDirectory) {
        toast.error('Directory picker only available in desktop app');
        return;
      }
      
      const selectedPath = await window.electron.pickDirectory();
      if (selectedPath) {
        const result = await window.electron.setProjectDirectory?.(selectedPath);
        if (result?.success) {
          toast.success('Project directory configured successfully!');
          onComplete();
        }
      }
    } catch (error: any) {
      console.error('Failed to set directory:', error);
      toast.error(error.message || 'Failed to configure directory');
    }
  };

  const handleCreateNew = async () => {
    setIsCreating(true);
    try {
      if (!window.electron?.createDefaultProjectDirectory) {
        toast.error('Create directory only available in desktop app');
        return;
      }
      
      // Create default directory in user's home
      const result = await window.electron.createDefaultProjectDirectory();
      if (result.success && result.path) {
        await window.electron.setProjectDirectory?.(result.path);
        toast.success(`Created project directory at ${result.path}`);
        onComplete();
      }
    } catch (error: any) {
      console.error('Failed to create directory:', error);
      toast.error(error.message || 'Failed to create project directory');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Welcome to Quant Chat Workbench!</DialogTitle>
          <DialogDescription>
            Please select your project directory where trading strategies and backtest results will be stored.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <Button
              className="w-full justify-start h-auto py-4"
              variant="outline"
              onClick={handleBrowse}
            >
              <FolderOpen className="mr-3 h-5 w-5" />
              <div className="text-left">
                <div className="font-semibold">Browse for Existing Directory</div>
                <div className="text-sm text-muted-foreground">
                  Select your rotation-engine repository
                </div>
              </div>
            </Button>

            <Button
              className="w-full justify-start h-auto py-4"
              variant="outline"
              onClick={handleCreateNew}
              disabled={isCreating}
            >
              <FolderPlus className="mr-3 h-5 w-5" />
              <div className="text-left">
                <div className="font-semibold">
                  {isCreating ? 'Creating...' : 'Create New Directory'}
                </div>
                <div className="text-sm text-muted-foreground">
                  Set up a new project in ~/quant-projects/
                </div>
              </div>
            </Button>
          </div>

          <div className="text-sm text-muted-foreground border-t pt-4">
            💡 You can change this later in Settings → Project Directory
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
