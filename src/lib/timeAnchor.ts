/**
 * TimeAnchor - Relative timestamp utility for ADHD-friendly time display
 *
 * PHASE 3: ADHD Cognitive Support
 *
 * Converts absolute timestamps to relative format:
 * - "Just now" (< 1 min)
 * - "2 min ago"
 * - "3 hours ago"
 * - "Yesterday 2pm"
 * - "Monday 9am"
 * - "Dec 5, 2pm"
 *
 * ADHD Design:
 * - Relative time is easier to process than "2024-12-07T14:52:27Z"
 * - Hover shows absolute time for precision when needed
 * - Consistent format across all components
 */

// =========================================================================
// Configuration
// =========================================================================

interface TimeAnchorOptions {
  /** Include "ago" suffix for past times */
  includeAgo?: boolean;
  /** Show full date after this many days (default: 7) */
  showFullDateAfterDays?: number;
  /** Use 12-hour format (default: true) */
  use12Hour?: boolean;
  /** Capitalize first letter (default: true) */
  capitalize?: boolean;
}

const DEFAULT_OPTIONS: TimeAnchorOptions = {
  includeAgo: true,
  showFullDateAfterDays: 7,
  use12Hour: true,
  capitalize: true,
};

// =========================================================================
// Core Functions
// =========================================================================

/**
 * Format a timestamp as a relative time string
 *
 * @param timestamp - Date, string, or number to format
 * @param options - Formatting options
 * @returns Relative time string like "2 hours ago"
 */
export function formatRelativeTime(
  timestamp: Date | string | number,
  options: TimeAnchorOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const now = new Date();

  // Handle invalid dates
  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  let result: string;

  // Future times
  if (diffMs < 0) {
    result = formatFutureTime(date, now, opts);
  }
  // Just now (< 1 min)
  else if (diffMin < 1) {
    result = 'just now';
  }
  // Minutes (1-59 min)
  else if (diffMin < 60) {
    result = `${diffMin} min${opts.includeAgo ? ' ago' : ''}`;
  }
  // Hours (1-23 hr)
  else if (diffHour < 24) {
    result = `${diffHour} hour${diffHour !== 1 ? 's' : ''}${opts.includeAgo ? ' ago' : ''}`;
  }
  // Yesterday
  else if (diffDay === 1 || (diffDay === 0 && !isSameDay(date, now))) {
    result = `yesterday ${formatTime(date, opts.use12Hour)}`;
  }
  // This week (2-6 days)
  else if (diffDay < 7) {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    result = `${dayName} ${formatTime(date, opts.use12Hour)}`;
  }
  // Within showFullDateAfterDays
  else if (diffDay < (opts.showFullDateAfterDays || 7)) {
    result = `${diffDay} days ago`;
  }
  // Older
  else {
    result = formatFullDate(date, opts.use12Hour);
  }

  // Capitalize if needed
  if (opts.capitalize && result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return result;
}

/**
 * Format a future time
 */
function formatFutureTime(
  date: Date,
  now: Date,
  opts: TimeAnchorOptions
): string {
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.floor(diffMs / 1000 / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffMin < 1) {
    return 'in a moment';
  }
  if (diffMin < 60) {
    return `in ${diffMin} min`;
  }
  if (diffHour < 24) {
    return `in ${diffHour} hour${diffHour !== 1 ? 's' : ''}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameDay(date, tomorrow)) {
    return `tomorrow ${formatTime(date, opts.use12Hour)}`;
  }

  return formatFullDate(date, opts.use12Hour);
}

/**
 * Check if two dates are the same calendar day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Format time portion (e.g., "2pm" or "14:00")
 */
function formatTime(date: Date, use12Hour: boolean = true): string {
  if (use12Hour) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const period = hours >= 12 ? 'pm' : 'am';
    const displayHours = hours % 12 || 12;

    if (minutes === 0) {
      return `${displayHours}${period}`;
    }
    return `${displayHours}:${minutes.toString().padStart(2, '0')}${period}`;
  }

  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Format a full date (e.g., "Dec 5, 2pm")
 */
function formatFullDate(date: Date, use12Hour: boolean = true): string {
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  const time = formatTime(date, use12Hour);

  // Include year if different from current year
  const now = new Date();
  if (date.getFullYear() !== now.getFullYear()) {
    return `${month} ${day}, ${date.getFullYear()} ${time}`;
  }

  return `${month} ${day}, ${time}`;
}

/**
 * Format absolute timestamp for tooltip display
 */
export function formatAbsoluteTime(timestamp: Date | string | number): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);

  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// =========================================================================
// Market Hours Utilities
// =========================================================================

interface MarketHoursInfo {
  symbol: string;
  isOpen: boolean;
  currentSession: 'regular' | 'extended' | 'closed';
  timeUntilChange: string;
  nextEventTime: Date;
  nextEvent: 'open' | 'close' | 'extendedOpen' | 'extendedClose';
}

/**
 * Get market hours info for a symbol
 * Note: This is simplified - in production, use a proper market hours API
 */
export function getMarketHoursInfo(symbol: string = 'ES'): MarketHoursInfo {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute; // Minutes since midnight

  // ES/NQ futures hours (simplified - CME Globex)
  // Sunday 5pm CT - Friday 4pm CT with daily break 4pm-5pm CT
  // Converting to local time would need timezone handling

  // For demo: assume EST and regular stock market hours
  const regularOpen = 9.5 * 60; // 9:30 AM
  const regularClose = 16 * 60; // 4:00 PM
  const extendedOpen = 4 * 60; // 4:00 AM
  const extendedClose = 20 * 60; // 8:00 PM

  // Weekend check
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    // Calculate time until Sunday 5pm / Monday morning
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 2;
    const nextOpen = new Date(now);
    nextOpen.setDate(nextOpen.getDate() + daysUntilMonday);
    nextOpen.setHours(9, 30, 0, 0);

    return {
      symbol,
      isOpen: false,
      currentSession: 'closed',
      timeUntilChange: formatDuration(nextOpen, now),
      nextEventTime: nextOpen,
      nextEvent: 'open',
    };
  }

  let isOpen: boolean;
  let currentSession: 'regular' | 'extended' | 'closed';
  let nextEventTime: Date;
  let nextEvent: 'open' | 'close' | 'extendedOpen' | 'extendedClose';

  if (currentTime >= regularOpen && currentTime < regularClose) {
    // Regular trading hours
    isOpen = true;
    currentSession = 'regular';
    nextEventTime = new Date(now);
    nextEventTime.setHours(16, 0, 0, 0);
    nextEvent = 'close';
  } else if (currentTime >= extendedOpen && currentTime < regularOpen) {
    // Pre-market
    isOpen = true;
    currentSession = 'extended';
    nextEventTime = new Date(now);
    nextEventTime.setHours(9, 30, 0, 0);
    nextEvent = 'open';
  } else if (currentTime >= regularClose && currentTime < extendedClose) {
    // After-hours
    isOpen = true;
    currentSession = 'extended';
    nextEventTime = new Date(now);
    nextEventTime.setHours(20, 0, 0, 0);
    nextEvent = 'extendedClose';
  } else {
    // Closed
    isOpen = false;
    currentSession = 'closed';
    nextEventTime = new Date(now);
    if (currentTime < extendedOpen) {
      nextEventTime.setHours(4, 0, 0, 0);
    } else {
      nextEventTime.setDate(nextEventTime.getDate() + 1);
      nextEventTime.setHours(4, 0, 0, 0);
    }
    nextEvent = 'extendedOpen';
  }

  return {
    symbol,
    isOpen,
    currentSession,
    timeUntilChange: formatDuration(nextEventTime, now),
    nextEventTime,
    nextEvent,
  };
}

/**
 * Format duration between two dates
 */
function formatDuration(future: Date, now: Date): string {
  const diffMs = future.getTime() - now.getTime();
  if (diffMs < 0) return 'now';

  const diffMin = Math.floor(diffMs / 1000 / 60);
  const diffHour = Math.floor(diffMin / 60);
  const remainingMin = diffMin % 60;

  if (diffHour === 0) {
    return `${diffMin}m`;
  }
  if (remainingMin === 0) {
    return `${diffHour}h`;
  }
  return `${diffHour}h ${remainingMin}m`;
}

// =========================================================================
// React Hook for Live Updates
// =========================================================================

/**
 * Hook that returns a relative time string and updates it periodically
 *
 * Usage:
 * ```tsx
 * const relativeTime = useRelativeTime(trade.timestamp);
 * return <span title={formatAbsoluteTime(trade.timestamp)}>{relativeTime}</span>;
 * ```
 */
export function useRelativeTimeState(
  timestamp: Date | string | number,
  options: TimeAnchorOptions = {}
): string {
  // This would normally use useState and useEffect to update periodically
  // For now, just return the formatted time
  return formatRelativeTime(timestamp, options);
}

// =========================================================================
// Export convenience functions
// =========================================================================

export const timeAnchor = {
  format: formatRelativeTime,
  absolute: formatAbsoluteTime,
  marketHours: getMarketHoursInfo,
};

export default timeAnchor;
