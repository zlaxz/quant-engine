import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FolderOpen, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export function ProjectDirectorySettings() {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [isValid, setIsValid] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadCurrentPath();
  }, []);

  const loadCurrentPath = async () => {
    try {
      // Check if running in Electron
      if (!window.electron?.getProjectDirectory) {
        setCurrentPath('Not available (web mode)');
        setIsValid(false);
        return;
      }
      
      const path = await window.electron.getProjectDirectory();
      setCurrentPath(path || 'Not set');
      setIsValid(!!path);
    } catch (error) {
      console.error('Failed to load project directory:', error);
      setCurrentPath('Error loading path');
      setIsValid(false);
    }
  };

  const handleBrowse = async () => {
    try {
      if (!window.electron?.pickDirectory) {
        toast.error('Directory picker only available in desktop app');
        return;
      }
      
      const selectedPath = await window.electron.pickDirectory();
      if (selectedPath) {
        setCurrentPath(selectedPath);
        setIsValid(true);
      }
    } catch (error) {
      console.error('Failed to pick directory:', error);
      toast.error('Failed to open directory picker');
    }
  };

  const handleApply = async () => {
    if (!currentPath || currentPath === 'Not set') {
      toast.error('Please select a directory first');
      return;
    }

    if (!window.electron?.setProjectDirectory) {
      toast.error('Settings only available in desktop app');
      return;
    }

    setIsLoading(true);
    try {
      const result = await window.electron.setProjectDirectory(currentPath);
      if (result.success) {
        toast.success('Project directory updated successfully');
        setIsValid(true);
      }
    } catch (error: any) {
      console.error('Failed to set project directory:', error);
      toast.error(error.message || 'Failed to set project directory');
      setIsValid(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Directory</CardTitle>
        <CardDescription>
          Configure where your trading strategies and backtest results are stored
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="project-path">Current Directory</Label>
          <div className="flex gap-2">
            <Input
              id="project-path"
              value={currentPath}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleBrowse}
              title="Browse for directory"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!isValid && currentPath !== 'Not set' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Directory is invalid or does not exist. Please select a valid directory.
            </AlertDescription>
          </Alert>
        )}

        {currentPath === 'Not set' && (
          <Alert>
            <AlertDescription>
              No project directory configured. Click Browse to select your rotation-engine directory.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleApply}
            disabled={isLoading || !isValid || currentPath === 'Not set'}
          >
            {isLoading ? (
              'Applying...'
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Apply
              </>
            )}
          </Button>
        </div>

        <Alert>
          <AlertDescription className="text-sm text-muted-foreground">
            💡 Tip: Point this to your rotation-engine repository root directory (e.g., /Users/username/rotation-engine)
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
