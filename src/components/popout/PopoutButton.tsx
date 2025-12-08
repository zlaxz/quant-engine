/**
 * PopoutButton - One-click pop-out for any component
 *
 * PHASE 5: Operational Excellence
 *
 * Usage:
 * <PopoutButton
 *   preset="pnlDashboard"
 *   data={dashboardData}
 * />
 *
 * Or custom:
 * <PopoutButton
 *   id="custom-view"
 *   title="Custom View"
 *   visualizationType="custom"
 *   data={customData}
 * />
 */

import { ExternalLink, X, Focus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { usePopout, POPOUT_PRESETS } from '@/hooks/usePopout';
import { cn } from '@/lib/utils';

// =========================================================================
// Types
// =========================================================================

type PresetKey = keyof typeof POPOUT_PRESETS;

interface PopoutButtonProps {
  // Use a preset configuration
  preset?: PresetKey;

  // Or provide custom config
  id?: string;
  title?: string;
  visualizationType?: string;
  width?: number;
  height?: number;

  // Data to pass to the popout
  data?: unknown;

  // Styling
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  variant?: 'default' | 'secondary' | 'ghost' | 'outline';

  // Show label or just icon
  showLabel?: boolean;
}

// =========================================================================
// Component
// =========================================================================

export function PopoutButton({
  preset,
  id,
  title,
  visualizationType,
  width,
  height,
  data,
  className,
  size = 'sm',
  variant = 'ghost',
  showLabel = false,
}: PopoutButtonProps) {
  const { togglePopout, closePopout, isPopoutOpen, isCreating } = usePopout();

  // Build config from preset or props
  const config = preset
    ? { ...POPOUT_PRESETS[preset], data }
    : {
        id: id || 'popout',
        title: title || 'Pop-out',
        visualizationType: visualizationType || 'generic',
        width,
        height,
        data,
      };

  const isOpen = isPopoutOpen(config.id);

  const handleClick = async () => {
    if (isOpen) {
      await closePopout(config.id);
    } else {
      await togglePopout(config);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={cn(
              isOpen && 'text-blue-500',
              className
            )}
            onClick={handleClick}
            disabled={isCreating}
          >
            {isOpen ? (
              <>
                <Focus className="h-4 w-4" />
                {showLabel && <span className="ml-1">Focused</span>}
              </>
            ) : (
              <>
                <ExternalLink className="h-4 w-4" />
                {showLabel && <span className="ml-1">Pop Out</span>}
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isOpen ? `Close ${config.title} pop-out` : `Pop out ${config.title}`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default PopoutButton;
