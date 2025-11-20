import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, FileText, Trash2, Edit3, Copy, FolderPlus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface WriteConfirmationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (createBackup: boolean) => void;
  operation: 'write' | 'append' | 'delete' | 'rename' | 'copy' | 'create_dir';
  path: string;
  newPath?: string;
  preview?: string;
  existingContent?: string;
}

const operationIcons = {
  write: FileText,
  append: Edit3,
  delete: Trash2,
  rename: Edit3,
  copy: Copy,
  create_dir: FolderPlus,
};

const operationLabels = {
  write: 'Write File',
  append: 'Append to File',
  delete: 'Delete File',
  rename: 'Rename File',
  copy: 'Copy File',
  create_dir: 'Create Directory',
};

const operationDescriptions = {
  write: 'This will create or overwrite the file with new content.',
  append: 'This will append content to the end of the file.',
  delete: 'This will permanently delete the file (a backup will be created).',
  rename: 'This will rename or move the file to a new location.',
  copy: 'This will create a copy of the file at the specified location.',
  create_dir: 'This will create a new directory.',
};

export function WriteConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  operation,
  path,
  newPath,
  preview,
  existingContent,
}: WriteConfirmationProps) {
  const [createBackup, setCreateBackup] = useState(true);
  
  const Icon = operationIcons[operation];
  const isDestructive = operation === 'delete' || operation === 'write';
  
  const handleConfirm = () => {
    onConfirm(createBackup);
    onOpenChange(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {operationLabels[operation]}
          </DialogTitle>
          <DialogDescription>
            {operationDescriptions[operation]}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Path information */}
          <div className="space-y-2">
            <div className="text-sm">
              <span className="font-semibold">Path:</span>{' '}
              <code className="bg-muted px-2 py-1 rounded text-xs">{path}</code>
            </div>
            {newPath && (
              <div className="text-sm">
                <span className="font-semibold">New Path:</span>{' '}
                <code className="bg-muted px-2 py-1 rounded text-xs">{newPath}</code>
              </div>
            )}
          </div>
          
          {/* Preview */}
          {preview && (
            <div className="space-y-2">
              <Label>Preview:</Label>
              <ScrollArea className="h-[300px] w-full rounded border bg-muted/50">
                <pre className="p-4 text-xs font-mono whitespace-pre-wrap">
                  {preview}
                </pre>
              </ScrollArea>
            </div>
          )}
          
          {/* Existing content warning for delete */}
          {operation === 'delete' && existingContent && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This file will be permanently deleted. Make sure you want to proceed.
              </AlertDescription>
            </Alert>
          )}
          
          {/* Backup option */}
          {isDestructive && (
            <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded">
              <Checkbox
                id="create-backup"
                checked={createBackup}
                onCheckedChange={(checked) => setCreateBackup(checked === true)}
              />
              <Label
                htmlFor="create-backup"
                className="text-sm font-normal cursor-pointer"
              >
                Create backup before {operation === 'delete' ? 'deleting' : 'overwriting'} (recommended)
              </Label>
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant={isDestructive ? "destructive" : "default"}
            onClick={handleConfirm}
          >
            {operation === 'delete' ? 'Delete File' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
