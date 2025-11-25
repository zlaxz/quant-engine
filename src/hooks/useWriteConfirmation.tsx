import { useState, useCallback } from "react";
import {
  type WriteResult,
  type ConfirmationContext,
} from "@/lib/codeWriter";
import { WriteConfirmationDialog } from "@/components/code/WriteConfirmationDialog";

export function useWriteConfirmation() {
  const [confirmationContext, setConfirmationContext] = useState<ConfirmationContext | null>(null);
  const [confirmationCallback, setConfirmationCallback] = useState<((createBackup: boolean) => Promise<WriteResult>) | null>(null);

  const showConfirmation = useCallback((
    context: ConfirmationContext,
    onConfirm: (createBackup: boolean) => Promise<WriteResult>
  ) => {
    setConfirmationContext(context);
    setConfirmationCallback(() => onConfirm);
  }, []);

  const handleConfirm = useCallback(async (createBackup: boolean) => {
    if (confirmationCallback) {
      const result = await confirmationCallback(createBackup);
      setConfirmationContext(null);
      setConfirmationCallback(null);
      return result;
    }
    return { success: false, error: 'No confirmation callback set' };
  }, [confirmationCallback]);

  const handleCancel = useCallback(() => {
    setConfirmationContext(null);
    setConfirmationCallback(null);
  }, []);

  return {
    confirmationContext,
    showConfirmation,
    handleConfirm,
    handleCancel,
    ConfirmationDialog: () => {
      if (!confirmationContext) return null;
      
      return (
        <WriteConfirmationDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) handleCancel();
          }}
          onConfirm={handleConfirm}
          operation={confirmationContext.operation.operation}
          path={confirmationContext.operation.path}
          newPath={confirmationContext.operation.newPath}
          preview={confirmationContext.preview}
          existingContent={confirmationContext.existingContent}
        />
      );
    }
  };
}
