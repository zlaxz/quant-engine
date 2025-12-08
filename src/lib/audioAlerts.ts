/**
 * AudioAlerts - Sound notification system for trading alerts
 *
 * PHASE 3: ADHD Cognitive Support
 *
 * Audio Categories:
 * - CRITICAL (cannot be disabled): Kill switch, live port, daily limit, circuit breaker
 * - WARNING (configurable): Connection lost, risk limit, strategy degradation
 * - SUCCESS (configurable): Trade executed, connection restored
 * - CHIME (configurable): Session resume, general notifications
 *
 * ADHD Design:
 * - Critical sounds ALWAYS play (safety first)
 * - User can mute non-critical sounds
 * - Sounds are distinct and meaningful
 * - No sound fatigue from excessive alerts
 */

// =========================================================================
// Types
// =========================================================================

type AlertCategory = 'critical' | 'warning' | 'success' | 'chime';

type AlertEvent =
  // Critical (always plays)
  | 'kill_switch_activated'
  | 'live_port_connected'
  | 'daily_loss_limit_hit'
  | 'circuit_breaker_triggered'
  | 'connection_lost_with_positions'
  // Warning (configurable)
  | 'connection_lost'
  | 'risk_limit_approaching'
  | 'critical_alert_received'
  | 'strategy_degradation'
  // Success (configurable)
  | 'trade_executed'
  | 'connection_restored'
  | 'strategy_validated'
  | 'strategy_promoted'
  // Chime (configurable)
  | 'session_resume'
  | 'backtest_completed'
  | 'info_notification';

interface AudioAlertSettings {
  enabled: boolean;
  volume: number; // 0-1
  categories: {
    warning: boolean;
    success: boolean;
    chime: boolean;
  };
  // Individual event overrides
  events: Partial<Record<AlertEvent, boolean>>;
}

interface AudioAlert {
  event: AlertEvent;
  category: AlertCategory;
  soundFile: string;
  canDisable: boolean;
}

// =========================================================================
// Configuration
// =========================================================================

const AUDIO_PATH = '/sounds';

const ALERT_CONFIG: Record<AlertEvent, Omit<AudioAlert, 'event'>> = {
  // Critical - CANNOT be disabled
  kill_switch_activated: {
    category: 'critical',
    soundFile: 'critical.mp3',
    canDisable: false,
  },
  live_port_connected: {
    category: 'critical',
    soundFile: 'critical.mp3',
    canDisable: false,
  },
  daily_loss_limit_hit: {
    category: 'critical',
    soundFile: 'critical.mp3',
    canDisable: false,
  },
  circuit_breaker_triggered: {
    category: 'critical',
    soundFile: 'critical.mp3',
    canDisable: false,
  },
  connection_lost_with_positions: {
    category: 'critical',
    soundFile: 'critical.mp3',
    canDisable: false,
  },

  // Warning - configurable
  connection_lost: {
    category: 'warning',
    soundFile: 'warning.mp3',
    canDisable: true,
  },
  risk_limit_approaching: {
    category: 'warning',
    soundFile: 'warning.mp3',
    canDisable: true,
  },
  critical_alert_received: {
    category: 'warning',
    soundFile: 'warning.mp3',
    canDisable: true,
  },
  strategy_degradation: {
    category: 'warning',
    soundFile: 'warning.mp3',
    canDisable: true,
  },

  // Success - configurable
  trade_executed: {
    category: 'success',
    soundFile: 'success.mp3',
    canDisable: true,
  },
  connection_restored: {
    category: 'success',
    soundFile: 'success.mp3',
    canDisable: true,
  },
  strategy_validated: {
    category: 'success',
    soundFile: 'success.mp3',
    canDisable: true,
  },
  strategy_promoted: {
    category: 'success',
    soundFile: 'success.mp3',
    canDisable: true,
  },

  // Chime - configurable
  session_resume: {
    category: 'chime',
    soundFile: 'chime.mp3',
    canDisable: true,
  },
  backtest_completed: {
    category: 'chime',
    soundFile: 'chime.mp3',
    canDisable: true,
  },
  info_notification: {
    category: 'chime',
    soundFile: 'chime.mp3',
    canDisable: true,
  },
};

// Default settings
const DEFAULT_SETTINGS: AudioAlertSettings = {
  enabled: true,
  volume: 0.7,
  categories: {
    warning: true,
    success: true,
    chime: true,
  },
  events: {},
};

// =========================================================================
// State Management
// =========================================================================

let currentSettings: AudioAlertSettings = { ...DEFAULT_SETTINGS };
let audioCache: Map<string, HTMLAudioElement> = new Map();
let lastPlayedTime: Map<string, number> = new Map();

// Debounce interval (ms) - prevent sound spam
const DEBOUNCE_MS = 500;

// =========================================================================
// Core Functions
// =========================================================================

/**
 * Initialize the audio alert system
 * Call this on app startup to preload audio files
 */
export function initAudioAlerts(): void {
  // Load settings from localStorage
  const stored = localStorage.getItem('audioAlertSettings');
  if (stored) {
    try {
      currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    } catch (e) {
      console.warn('[AudioAlerts] Failed to parse stored settings:', e);
    }
  }

  // Preload audio files
  const soundFiles = new Set(Object.values(ALERT_CONFIG).map((c) => c.soundFile));
  soundFiles.forEach((file) => {
    preloadAudio(file);
  });

  console.log('[AudioAlerts] Initialized with settings:', currentSettings);
}

/**
 * Preload an audio file for faster playback
 */
function preloadAudio(filename: string): void {
  if (audioCache.has(filename)) return;

  try {
    const audio = new Audio(`${AUDIO_PATH}/${filename}`);
    audio.preload = 'auto';
    audio.volume = currentSettings.volume;
    audioCache.set(filename, audio);
  } catch (e) {
    console.warn(`[AudioAlerts] Failed to preload ${filename}:`, e);
  }
}

/**
 * Play an audio alert for a specific event
 *
 * @param event - The event type to play audio for
 * @returns Promise that resolves when audio finishes or rejects on error
 */
export async function playAlert(event: AlertEvent): Promise<void> {
  const config = ALERT_CONFIG[event];
  if (!config) {
    console.warn(`[AudioAlerts] Unknown event: ${event}`);
    return;
  }

  // Check if should play
  if (!shouldPlayAlert(event, config)) {
    return;
  }

  // Debounce check
  const now = Date.now();
  const lastPlayed = lastPlayedTime.get(event) || 0;
  if (now - lastPlayed < DEBOUNCE_MS) {
    console.log(`[AudioAlerts] Debounced: ${event}`);
    return;
  }
  lastPlayedTime.set(event, now);

  // Play the audio
  try {
    await playAudioFile(config.soundFile);
    console.log(`[AudioAlerts] Played: ${event}`);
  } catch (e) {
    console.error(`[AudioAlerts] Failed to play ${event}:`, e);
  }
}

/**
 * Check if an alert should play based on settings
 */
function shouldPlayAlert(
  event: AlertEvent,
  config: Omit<AudioAlert, 'event'>
): boolean {
  // Critical alerts ALWAYS play
  if (!config.canDisable) {
    return true;
  }

  // Check if audio is globally enabled
  if (!currentSettings.enabled) {
    return false;
  }

  // Check individual event override
  if (currentSettings.events[event] !== undefined) {
    return currentSettings.events[event];
  }

  // Check category setting
  if (config.category !== 'critical') {
    return currentSettings.categories[config.category] ?? true;
  }

  return true;
}

/**
 * Play an audio file
 */
async function playAudioFile(filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let audio = audioCache.get(filename);

    if (!audio) {
      // Create new audio element if not cached
      audio = new Audio(`${AUDIO_PATH}/${filename}`);
      audioCache.set(filename, audio);
    }

    // Reset to beginning if already playing
    audio.currentTime = 0;
    audio.volume = currentSettings.volume;

    const onEnded = () => {
      audio?.removeEventListener('ended', onEnded);
      audio?.removeEventListener('error', onError);
      resolve();
    };

    const onError = (e: Event) => {
      audio?.removeEventListener('ended', onEnded);
      audio?.removeEventListener('error', onError);
      reject(e);
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    audio.play().catch((e) => {
      // Browser may block autoplay
      console.warn(`[AudioAlerts] Playback blocked: ${filename}`, e);
      reject(e);
    });
  });
}

// =========================================================================
// Settings Management
// =========================================================================

/**
 * Get current audio alert settings
 */
export function getSettings(): AudioAlertSettings {
  return { ...currentSettings };
}

/**
 * Update audio alert settings
 */
export function updateSettings(settings: Partial<AudioAlertSettings>): void {
  currentSettings = {
    ...currentSettings,
    ...settings,
    categories: {
      ...currentSettings.categories,
      ...settings.categories,
    },
    events: {
      ...currentSettings.events,
      ...settings.events,
    },
  };

  // Update volume on cached audio elements
  if (settings.volume !== undefined) {
    audioCache.forEach((audio) => {
      audio.volume = settings.volume!;
    });
  }

  // Persist to localStorage
  localStorage.setItem('audioAlertSettings', JSON.stringify(currentSettings));

  console.log('[AudioAlerts] Settings updated:', currentSettings);
}

/**
 * Toggle audio alerts globally (except critical)
 */
export function toggleAudio(enabled?: boolean): boolean {
  const newEnabled = enabled ?? !currentSettings.enabled;
  updateSettings({ enabled: newEnabled });
  return newEnabled;
}

/**
 * Set master volume
 */
export function setVolume(volume: number): void {
  updateSettings({ volume: Math.max(0, Math.min(1, volume)) });
}

/**
 * Toggle a specific category
 */
export function toggleCategory(
  category: 'warning' | 'success' | 'chime',
  enabled?: boolean
): boolean {
  const newEnabled = enabled ?? !currentSettings.categories[category];
  updateSettings({
    categories: {
      ...currentSettings.categories,
      [category]: newEnabled,
    },
  });
  return newEnabled;
}

/**
 * Toggle a specific event
 */
export function toggleEvent(event: AlertEvent, enabled?: boolean): boolean | undefined {
  const config = ALERT_CONFIG[event];
  if (!config || !config.canDisable) {
    console.warn(`[AudioAlerts] Cannot disable critical event: ${event}`);
    return undefined;
  }

  const newEnabled = enabled ?? !(currentSettings.events[event] ?? true);
  updateSettings({
    events: {
      ...currentSettings.events,
      [event]: newEnabled,
    },
  });
  return newEnabled;
}

// =========================================================================
// Testing Utilities
// =========================================================================

/**
 * Test play a specific sound file
 */
export async function testSound(
  category: 'critical' | 'warning' | 'success' | 'chime'
): Promise<void> {
  const filename = `${category}.mp3`;
  await playAudioFile(filename);
}

/**
 * Check if audio is working (browser may block)
 */
export async function checkAudioSupport(): Promise<boolean> {
  try {
    // Try to create an AudioContext
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) {
      return false;
    }

    const ctx = new AudioContext();
    const state = ctx.state;
    await ctx.close();

    // If context is suspended, user interaction is needed
    return state !== 'suspended';
  } catch (e) {
    return false;
  }
}

// =========================================================================
// Convenience exports
// =========================================================================

export const audioAlerts = {
  init: initAudioAlerts,
  play: playAlert,
  getSettings,
  updateSettings,
  toggle: toggleAudio,
  setVolume,
  toggleCategory,
  toggleEvent,
  testSound,
  checkAudioSupport,
};

export default audioAlerts;
