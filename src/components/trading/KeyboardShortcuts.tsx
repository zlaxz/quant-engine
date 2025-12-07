/**
 * KeyboardShortcuts - Overlay showing available keyboard shortcuts
 *
 * Displays when user presses ? or Cmd+K
 */

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Keyboard } from 'lucide-react';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Global Navigation',
    shortcuts: [
      { keys: ['⌘', '1'], description: 'Go to Home' },
      { keys: ['⌘', '2'], description: 'Go to Trading Terminal' },
      { keys: ['⌘', '3'], description: 'Go to Strategy Library' },
      { keys: ['⌘', '4'], description: 'Go to Dashboard' },
      { keys: ['⌘', '5'], description: 'Go to Settings' },
    ],
  },
  {
    title: 'Terminal Tabs',
    shortcuts: [
      { keys: ['⌘', 'Shift', '1'], description: 'Overview tab' },
      { keys: ['⌘', 'Shift', '2'], description: 'Pipeline tab' },
      { keys: ['⌘', 'Shift', '3'], description: 'Swarm tab' },
      { keys: ['⌘', 'Shift', '4'], description: 'P&L tab' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['⌘', 'F'], description: 'Toggle fullscreen' },
      { keys: ['⌘', 'R'], description: 'Refresh data' },
      { keys: ['Space'], description: 'Play/pause animations' },
      { keys: ['Esc'], description: 'Close dialogs/modals' },
    ],
  },
  {
    title: 'Help',
    shortcuts: [
      { keys: ['?'], description: 'Show this menu' },
      { keys: ['⌘', 'K'], description: 'Command palette' },
    ],
  },
];

interface KeyboardShortcutsProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function KeyboardShortcuts({ open: controlledOpen, onOpenChange }: KeyboardShortcutsProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Show shortcuts on ? key (without modifiers)
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
      // Close on Escape
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {SHORTCUTS.map((group) => (
            <div key={group.title}>
              <h4 className="text-sm font-semibold text-muted-foreground mb-3">
                {group.title}
              </h4>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{shortcut.description}</span>
                    <div className="flex gap-1">
                      {shortcut.keys.map((key, j) => (
                        <Badge
                          key={j}
                          variant="outline"
                          className="font-mono text-xs px-2 py-0.5"
                        >
                          {key}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground text-center pt-2 border-t">
          Press <Badge variant="outline" className="font-mono text-[10px] mx-1">?</Badge> to toggle this menu
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default KeyboardShortcuts;
