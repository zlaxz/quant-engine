/**
 * Educational Tooltip Component
 * Provides hover explanations for quantitative concepts
 */

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    variant?: 'default' | 'educational'
  }
>(({ className, sideOffset = 4, variant = 'default', ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border px-3 py-1.5 text-sm shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      variant === 'educational' && "bg-primary/5 border-primary/20 text-primary max-w-xs",
      variant === 'default' && "bg-popover text-popover-foreground",
      className
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

/**
 * Educational Tooltip - Pre-configured for teaching concepts
 */
interface EducationalTooltipProps {
  term: string
  definition: string
  children: React.ReactNode
}

export function EducationalTooltip({ term, definition, children }: EducationalTooltipProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted underline-offset-4 decoration-primary/40">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent variant="educational" side="top" align="center">
          <div className="space-y-1">
            <p className="font-semibold text-xs">{term}</p>
            <p className="text-xs leading-relaxed">{definition}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
