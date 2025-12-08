/**
 * Trading - Live Trading Interface
 *
 * ADHD Design: Just what you need to trade.
 * - Positions and P&L
 * - Quick order entry
 * - Kill switch always visible
 * - No gamification, no XP, no achievements
 */

import { LiveTradingPanel } from '@/components/trading/LiveTradingPanel';

export default function Trading() {
  return (
    <div className="h-full p-4">
      <LiveTradingPanel />
    </div>
  );
}
