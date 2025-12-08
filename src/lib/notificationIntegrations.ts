/**
 * notificationIntegrations - Slack and Discord webhook notifications
 *
 * PHASE 6: Future Enhancements
 *
 * Features:
 * - Slack webhook integration for alerts
 * - Discord webhook integration for alerts
 * - Telegram integration (already exists in infra config)
 * - Daily summary messages
 * - Critical alert escalation
 *
 * ADHD Design:
 * - Push critical alerts to phone
 * - Can't miss important events even away from computer
 */

// =========================================================================
// Types
// =========================================================================

interface NotificationConfig {
  slack: {
    enabled: boolean;
    webhookUrl: string;
    channel?: string;
  };
  discord: {
    enabled: boolean;
    webhookUrl: string;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  };
}

interface NotificationPayload {
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
  timestamp: Date;
  data?: Record<string, any>;
}

// =========================================================================
// Configuration
// =========================================================================

let config: NotificationConfig = {
  slack: {
    enabled: false,
    webhookUrl: '',
  },
  discord: {
    enabled: false,
    webhookUrl: '',
  },
  telegram: {
    enabled: false,
    botToken: '',
    chatId: '',
  },
};

/**
 * Load notification config from localStorage
 */
export function loadNotificationConfig(): NotificationConfig {
  try {
    const saved = localStorage.getItem('notificationConfig');
    if (saved) {
      config = { ...config, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('[Notifications] Failed to load config:', e);
  }
  return config;
}

/**
 * Save notification config to localStorage
 */
export function saveNotificationConfig(newConfig: Partial<NotificationConfig>): void {
  config = { ...config, ...newConfig };
  try {
    localStorage.setItem('notificationConfig', JSON.stringify(config));
  } catch (e) {
    console.error('[Notifications] Failed to save config:', e);
  }
}

/**
 * Get current config
 */
export function getNotificationConfig(): NotificationConfig {
  return { ...config };
}

// =========================================================================
// Slack Integration
// =========================================================================

/**
 * Send notification to Slack
 */
async function sendToSlack(payload: NotificationPayload): Promise<boolean> {
  if (!config.slack.enabled || !config.slack.webhookUrl) {
    return false;
  }

  const color = {
    critical: '#DC2626',
    warning: '#F59E0B',
    info: '#3B82F6',
    success: '#10B981',
  }[payload.severity];

  const slackPayload = {
    channel: config.slack.channel,
    attachments: [
      {
        color,
        title: payload.title,
        text: payload.message,
        footer: 'Quant Engine',
        ts: Math.floor(payload.timestamp.getTime() / 1000),
        fields: payload.data
          ? Object.entries(payload.data).map(([key, value]) => ({
              title: key,
              value: String(value),
              short: true,
            }))
          : undefined,
      },
    ],
  };

  try {
    const response = await fetch(config.slack.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
    });
    return response.ok;
  } catch (e) {
    console.error('[Notifications] Slack error:', e);
    return false;
  }
}

// =========================================================================
// Discord Integration
// =========================================================================

/**
 * Send notification to Discord
 */
async function sendToDiscord(payload: NotificationPayload): Promise<boolean> {
  if (!config.discord.enabled || !config.discord.webhookUrl) {
    return false;
  }

  const color = {
    critical: 0xdc2626,
    warning: 0xf59e0b,
    info: 0x3b82f6,
    success: 0x10b981,
  }[payload.severity];

  const discordPayload = {
    embeds: [
      {
        title: payload.title,
        description: payload.message,
        color,
        timestamp: payload.timestamp.toISOString(),
        footer: {
          text: 'Quant Engine',
        },
        fields: payload.data
          ? Object.entries(payload.data).map(([key, value]) => ({
              name: key,
              value: String(value),
              inline: true,
            }))
          : undefined,
      },
    ],
  };

  try {
    const response = await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
    });
    return response.ok;
  } catch (e) {
    console.error('[Notifications] Discord error:', e);
    return false;
  }
}

// =========================================================================
// Telegram Integration
// =========================================================================

/**
 * Send notification to Telegram
 */
async function sendToTelegram(payload: NotificationPayload): Promise<boolean> {
  if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) {
    return false;
  }

  const emoji = {
    critical: '\u{1F6A8}',
    warning: '\u{26A0}\u{FE0F}',
    info: '\u{2139}\u{FE0F}',
    success: '\u{2705}',
  }[payload.severity];

  const text = `${emoji} *${payload.title}*\n\n${payload.message}${
    payload.data
      ? '\n\n' +
        Object.entries(payload.data)
          .map(([k, v]) => `*${k}:* ${v}`)
          .join('\n')
      : ''
  }`;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text,
          parse_mode: 'Markdown',
        }),
      }
    );
    const data = await response.json();
    return data.ok;
  } catch (e) {
    console.error('[Notifications] Telegram error:', e);
    return false;
  }
}

// =========================================================================
// Unified Send Functions
// =========================================================================

/**
 * Send notification to all enabled channels
 */
export async function sendNotification(payload: NotificationPayload): Promise<{
  slack: boolean;
  discord: boolean;
  telegram: boolean;
}> {
  const results = await Promise.all([
    sendToSlack(payload),
    sendToDiscord(payload),
    sendToTelegram(payload),
  ]);

  return {
    slack: results[0],
    discord: results[1],
    telegram: results[2],
  };
}

/**
 * Send critical alert (sends to all channels regardless of settings)
 */
export async function sendCriticalAlert(
  title: string,
  message: string,
  data?: Record<string, any>
): Promise<void> {
  const payload: NotificationPayload = {
    title,
    message,
    severity: 'critical',
    timestamp: new Date(),
    data,
  };

  // Force send to all configured channels
  const originalSlackEnabled = config.slack.enabled;
  const originalDiscordEnabled = config.discord.enabled;
  const originalTelegramEnabled = config.telegram.enabled;

  config.slack.enabled = !!config.slack.webhookUrl;
  config.discord.enabled = !!config.discord.webhookUrl;
  config.telegram.enabled = !!config.telegram.botToken && !!config.telegram.chatId;

  await sendNotification(payload);

  config.slack.enabled = originalSlackEnabled;
  config.discord.enabled = originalDiscordEnabled;
  config.telegram.enabled = originalTelegramEnabled;
}

/**
 * Send warning alert
 */
export async function sendWarningAlert(
  title: string,
  message: string,
  data?: Record<string, any>
): Promise<void> {
  await sendNotification({
    title,
    message,
    severity: 'warning',
    timestamp: new Date(),
    data,
  });
}

/**
 * Send info notification
 */
export async function sendInfoNotification(
  title: string,
  message: string,
  data?: Record<string, any>
): Promise<void> {
  await sendNotification({
    title,
    message,
    severity: 'info',
    timestamp: new Date(),
    data,
  });
}

/**
 * Send success notification
 */
export async function sendSuccessNotification(
  title: string,
  message: string,
  data?: Record<string, any>
): Promise<void> {
  await sendNotification({
    title,
    message,
    severity: 'success',
    timestamp: new Date(),
    data,
  });
}

// =========================================================================
// Pre-defined Notifications
// =========================================================================

/**
 * Send daily summary
 */
export async function sendDailySummary(summary: {
  pnl: number;
  pnlPercent: number;
  trades: number;
  winRate: number;
  regime: string;
  strategiesActive: number;
  alerts: number;
}): Promise<void> {
  const pnlEmoji = summary.pnl >= 0 ? '\u{1F4C8}' : '\u{1F4C9}';
  const pnlSign = summary.pnl >= 0 ? '+' : '';

  await sendInfoNotification(
    `${pnlEmoji} Daily Summary`,
    `P&L: ${pnlSign}$${summary.pnl.toLocaleString()} (${pnlSign}${summary.pnlPercent.toFixed(2)}%)`,
    {
      Trades: summary.trades,
      'Win Rate': `${(summary.winRate * 100).toFixed(0)}%`,
      Regime: summary.regime,
      'Active Strategies': summary.strategiesActive,
      Alerts: summary.alerts,
    }
  );
}

/**
 * Send market opening reminder
 */
export async function sendMarketOpeningReminder(
  symbol: string,
  minutesUntilOpen: number
): Promise<void> {
  await sendInfoNotification(
    `\u{1F514} Market Opening`,
    `${symbol} market opens in ${minutesUntilOpen} minutes`,
    { Symbol: symbol, Time: `${minutesUntilOpen}m` }
  );
}

/**
 * Send kill switch notification
 */
export async function sendKillSwitchNotification(
  reason: string,
  positionsClosed: number,
  ordersCancelled: number
): Promise<void> {
  await sendCriticalAlert(
    '\u{1F6A8} KILL SWITCH ACTIVATED',
    reason,
    {
      'Positions Closed': positionsClosed,
      'Orders Cancelled': ordersCancelled,
      Time: new Date().toLocaleTimeString(),
    }
  );
}

// =========================================================================
// Test Functions
// =========================================================================

/**
 * Test Slack webhook
 */
export async function testSlackWebhook(webhookUrl: string): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '\u{1F9EA} Test from Quant Engine - Slack integration working!',
      }),
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

/**
 * Test Discord webhook
 */
export async function testDiscordWebhook(webhookUrl: string): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '\u{1F9EA} Test from Quant Engine - Discord integration working!',
      }),
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

// =========================================================================
// React Hook
// =========================================================================

import { useState, useEffect, useCallback } from 'react';

interface UseNotificationsReturn {
  config: NotificationConfig;
  updateConfig: (newConfig: Partial<NotificationConfig>) => void;
  sendNotification: (payload: NotificationPayload) => Promise<void>;
  testSlack: (url: string) => Promise<boolean>;
  testDiscord: (url: string) => Promise<boolean>;
}

export function useNotifications(): UseNotificationsReturn {
  const [currentConfig, setCurrentConfig] = useState<NotificationConfig>(config);

  useEffect(() => {
    const loaded = loadNotificationConfig();
    setCurrentConfig(loaded);
  }, []);

  const handleUpdateConfig = useCallback((newConfig: Partial<NotificationConfig>) => {
    saveNotificationConfig(newConfig);
    setCurrentConfig(getNotificationConfig());
  }, []);

  const handleSendNotification = useCallback(async (payload: NotificationPayload) => {
    await sendNotification(payload);
  }, []);

  return {
    config: currentConfig,
    updateConfig: handleUpdateConfig,
    sendNotification: handleSendNotification,
    testSlack: testSlackWebhook,
    testDiscord: testDiscordWebhook,
  };
}

export default {
  loadNotificationConfig,
  saveNotificationConfig,
  getNotificationConfig,
  sendNotification,
  sendCriticalAlert,
  sendWarningAlert,
  sendInfoNotification,
  sendSuccessNotification,
  sendDailySummary,
  sendMarketOpeningReminder,
  sendKillSwitchNotification,
  testSlackWebhook,
  testDiscordWebhook,
  useNotifications,
};
