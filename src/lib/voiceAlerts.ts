/**
 * voiceAlerts - Text-to-speech for critical alerts
 *
 * PHASE 6: Future Enhancements
 *
 * Features:
 * - Text-to-speech for critical events
 * - Configurable voice and rate
 * - Queue management for multiple alerts
 * - Fallback to audio files if TTS unavailable
 *
 * ADHD Design:
 * - Voice alerts are harder to ignore than visual
 * - Clear, concise messages
 * - Urgent tone for critical alerts
 */

// =========================================================================
// Types
// =========================================================================

interface VoiceSettings {
  enabled: boolean;
  voice: string;
  rate: number; // 0.1 to 10
  pitch: number; // 0 to 2
  volume: number; // 0 to 1
}

interface QueuedMessage {
  text: string;
  priority: 'critical' | 'high' | 'normal';
}

// =========================================================================
// State
// =========================================================================

let voiceSettings: VoiceSettings = {
  enabled: true,
  voice: '', // Will be set to default
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
};

let messageQueue: QueuedMessage[] = [];
let isSpeaking = false;
let synth: SpeechSynthesis | null = null;

// =========================================================================
// Initialization
// =========================================================================

/**
 * Initialize the voice alert system
 */
export function initVoiceAlerts(): boolean {
  if (typeof window === 'undefined') return false;

  synth = window.speechSynthesis;

  if (!synth) {
    console.warn('[VoiceAlerts] Speech synthesis not supported');
    return false;
  }

  // Load settings from localStorage
  try {
    const saved = localStorage.getItem('voiceAlertSettings');
    if (saved) {
      voiceSettings = { ...voiceSettings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('[VoiceAlerts] Failed to load settings:', e);
  }

  // Get available voices (may load async)
  const loadVoices = () => {
    const voices = synth!.getVoices();
    if (voices.length > 0 && !voiceSettings.voice) {
      // Try to find a good English voice
      const preferred = voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Samantha') ||
            v.name.includes('Daniel') ||
            v.name.includes('Google'))
      );
      voiceSettings.voice = preferred?.name || voices[0].name;
    }
  };

  loadVoices();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = loadVoices;
  }

  console.log('[VoiceAlerts] Initialized');
  return true;
}

/**
 * Get available voices
 */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!synth) return [];
  return synth.getVoices().filter((v) => v.lang.startsWith('en'));
}

/**
 * Update voice settings
 */
export function updateVoiceSettings(settings: Partial<VoiceSettings>): void {
  voiceSettings = { ...voiceSettings, ...settings };
  try {
    localStorage.setItem('voiceAlertSettings', JSON.stringify(voiceSettings));
  } catch (e) {
    console.error('[VoiceAlerts] Failed to save settings:', e);
  }
}

/**
 * Get current voice settings
 */
export function getVoiceSettings(): VoiceSettings {
  return { ...voiceSettings };
}

// =========================================================================
// Speaking Functions
// =========================================================================

/**
 * Speak a message immediately (cancels current)
 */
export function speakImmediate(text: string): void {
  if (!synth || !voiceSettings.enabled) return;

  // Cancel any current speech
  synth.cancel();
  messageQueue = [];

  speak(text);
}

/**
 * Queue a message to be spoken
 */
export function speakQueued(
  text: string,
  priority: 'critical' | 'high' | 'normal' = 'normal'
): void {
  if (!synth || !voiceSettings.enabled) return;

  // Critical messages go to front of queue
  if (priority === 'critical') {
    messageQueue.unshift({ text, priority });
  } else {
    messageQueue.push({ text, priority });
  }

  processQueue();
}

/**
 * Internal speak function
 */
function speak(text: string): void {
  if (!synth) return;

  const utterance = new SpeechSynthesisUtterance(text);

  // Find the selected voice
  const voices = synth.getVoices();
  const selectedVoice = voices.find((v) => v.name === voiceSettings.voice);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  utterance.rate = voiceSettings.rate;
  utterance.pitch = voiceSettings.pitch;
  utterance.volume = voiceSettings.volume;

  utterance.onstart = () => {
    isSpeaking = true;
  };

  utterance.onend = () => {
    isSpeaking = false;
    processQueue();
  };

  utterance.onerror = (event) => {
    console.error('[VoiceAlerts] Speech error:', event.error);
    isSpeaking = false;
    processQueue();
  };

  synth.speak(utterance);
}

/**
 * Process the message queue
 */
function processQueue(): void {
  if (isSpeaking || messageQueue.length === 0) return;

  const next = messageQueue.shift();
  if (next) {
    speak(next.text);
  }
}

/**
 * Stop all speech
 */
export function stopSpeaking(): void {
  if (!synth) return;
  synth.cancel();
  messageQueue = [];
  isSpeaking = false;
}

// =========================================================================
// Pre-defined Alert Messages
// =========================================================================

/**
 * Critical alert messages that MUST be spoken
 */
export const CRITICAL_VOICE_ALERTS = {
  killSwitch: 'Emergency stop activated. All positions closed.',
  livePort: 'Warning: Connected to live trading account.',
  dailyLossLimit: 'Daily loss limit reached. Trading halted.',
  circuitBreaker: 'Circuit breaker triggered. Trading suspended.',
  connectionLost: 'Broker connection lost. Check positions immediately.',
};

/**
 * Warning alert messages
 */
export const WARNING_VOICE_ALERTS = {
  riskLimitApproaching: (percent: number) =>
    `Risk limit at ${percent} percent. Consider reducing exposure.`,
  strategyDegrading: (name: string) =>
    `Strategy ${name} is showing degradation. Review recommended.`,
  connectionRestored: 'Broker connection restored.',
  regimeChange: (from: string, to: string) =>
    `Market regime changed from ${from} to ${to}.`,
};

/**
 * Info alert messages
 */
export const INFO_VOICE_ALERTS = {
  sessionResume: (hours: number) =>
    `Welcome back. You were away for ${hours.toFixed(0)} hours.`,
  marketOpening: (symbol: string, minutes: number) =>
    `${symbol} market opens in ${minutes} minutes.`,
  marketClosing: (symbol: string, minutes: number) =>
    `${symbol} market closes in ${minutes} minutes.`,
};

// =========================================================================
// Convenience Functions
// =========================================================================

/**
 * Speak a critical alert (always speaks, cannot be disabled)
 */
export function speakCritical(message: string): void {
  if (!synth) return;

  // Critical alerts always speak, even if disabled
  const wasEnabled = voiceSettings.enabled;
  voiceSettings.enabled = true;

  speakImmediate(message);

  voiceSettings.enabled = wasEnabled;
}

/**
 * Speak a warning alert (respects settings)
 */
export function speakWarning(message: string): void {
  speakQueued(message, 'high');
}

/**
 * Speak an info alert (respects settings)
 */
export function speakInfo(message: string): void {
  speakQueued(message, 'normal');
}

// =========================================================================
// React Hook
// =========================================================================

import { useState, useEffect, useCallback } from 'react';

interface UseVoiceAlertsReturn {
  isSupported: boolean;
  isEnabled: boolean;
  isSpeaking: boolean;
  settings: VoiceSettings;
  voices: SpeechSynthesisVoice[];
  speak: (text: string) => void;
  speakCritical: (text: string) => void;
  stop: () => void;
  updateSettings: (settings: Partial<VoiceSettings>) => void;
}

export function useVoiceAlerts(): UseVoiceAlertsReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [isSpeakingState, setIsSpeakingState] = useState(false);
  const [settings, setSettings] = useState<VoiceSettings>(voiceSettings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const supported = initVoiceAlerts();
    setIsSupported(supported);

    if (supported) {
      setVoices(getAvailableVoices());
      setSettings(getVoiceSettings());

      // Poll speaking state
      const interval = setInterval(() => {
        setIsSpeakingState(isSpeaking);
      }, 100);

      return () => clearInterval(interval);
    }
  }, []);

  const handleSpeak = useCallback((text: string) => {
    speakQueued(text);
  }, []);

  const handleSpeakCritical = useCallback((text: string) => {
    speakCritical(text);
  }, []);

  const handleStop = useCallback(() => {
    stopSpeaking();
    setIsSpeakingState(false);
  }, []);

  const handleUpdateSettings = useCallback((newSettings: Partial<VoiceSettings>) => {
    updateVoiceSettings(newSettings);
    setSettings(getVoiceSettings());
  }, []);

  return {
    isSupported,
    isEnabled: settings.enabled,
    isSpeaking: isSpeakingState,
    settings,
    voices,
    speak: handleSpeak,
    speakCritical: handleSpeakCritical,
    stop: handleStop,
    updateSettings: handleUpdateSettings,
  };
}

export default {
  initVoiceAlerts,
  getAvailableVoices,
  updateVoiceSettings,
  getVoiceSettings,
  speakImmediate,
  speakQueued,
  stopSpeaking,
  speakCritical,
  speakWarning,
  speakInfo,
  useVoiceAlerts,
  CRITICAL_VOICE_ALERTS,
  WARNING_VOICE_ALERTS,
  INFO_VOICE_ALERTS,
};
