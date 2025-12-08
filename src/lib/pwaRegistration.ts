/**
 * PWA Registration and Utilities
 *
 * Handles:
 * - Service worker registration
 * - Push notification subscription
 * - Install prompt handling
 * - Update detection
 */

// =========================================================================
// Types
// =========================================================================

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PWAState {
  isInstallable: boolean;
  isInstalled: boolean;
  isOnline: boolean;
  hasUpdate: boolean;
  pushEnabled: boolean;
}

// =========================================================================
// State
// =========================================================================

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;

const state: PWAState = {
  isInstallable: false,
  isInstalled: false,
  isOnline: navigator.onLine,
  hasUpdate: false,
  pushEnabled: false,
};

const listeners: Set<(state: PWAState) => void> = new Set();

function notifyListeners() {
  listeners.forEach((fn) => fn({ ...state }));
}

// =========================================================================
// Service Worker Registration
// =========================================================================

/**
 * Register service worker
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] Service workers not supported');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    swRegistration = registration;
    console.log('[PWA] Service worker registered:', registration.scope);

    // Check for updates periodically
    setInterval(() => {
      registration.update();
    }, 60 * 60 * 1000); // Every hour

    // Handle updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;

      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            state.hasUpdate = true;
            notifyListeners();
            console.log('[PWA] New version available');
          }
        });
      }
    });

    return registration;
  } catch (error) {
    console.error('[PWA] Service worker registration failed:', error);
    return null;
  }
}

/**
 * Skip waiting and reload to get new version
 */
export function applyUpdate(): void {
  if (swRegistration?.waiting) {
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  }
}

// =========================================================================
// Install Prompt
// =========================================================================

/**
 * Initialize install prompt handling
 */
export function initInstallPrompt(): void {
  // Check if already installed
  if (window.matchMedia('(display-mode: standalone)').matches) {
    state.isInstalled = true;
    notifyListeners();
    return;
  }

  // Listen for install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    state.isInstallable = true;
    notifyListeners();
    console.log('[PWA] Install prompt available');
  });

  // Listen for successful install
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    state.isInstallable = false;
    state.isInstalled = true;
    notifyListeners();
    console.log('[PWA] App installed');
  });
}

/**
 * Show install prompt
 */
export async function promptInstall(): Promise<boolean> {
  if (!deferredInstallPrompt) {
    console.warn('[PWA] No install prompt available');
    return false;
  }

  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;

  deferredInstallPrompt = null;
  state.isInstallable = false;
  notifyListeners();

  return outcome === 'accepted';
}

// =========================================================================
// Push Notifications
// =========================================================================

/**
 * Subscribe to push notifications
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!swRegistration) {
    console.warn('[PWA] Service worker not registered');
    return null;
  }

  if (!('PushManager' in window)) {
    console.warn('[PWA] Push notifications not supported');
    return null;
  }

  try {
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      console.warn('[PWA] Push permission denied');
      return null;
    }

    // You would get this key from your push notification server
    // For now, we'll skip the actual subscription
    console.log('[PWA] Push notifications enabled (mock)');
    state.pushEnabled = true;
    notifyListeners();

    return null;
  } catch (error) {
    console.error('[PWA] Push subscription failed:', error);
    return null;
  }
}

// =========================================================================
// Online/Offline Detection
// =========================================================================

/**
 * Initialize online/offline detection
 */
export function initOnlineDetection(): void {
  window.addEventListener('online', () => {
    state.isOnline = true;
    notifyListeners();
    console.log('[PWA] Back online');
  });

  window.addEventListener('offline', () => {
    state.isOnline = false;
    notifyListeners();
    console.log('[PWA] Gone offline');
  });
}

// =========================================================================
// React Hook
// =========================================================================

import { useState, useEffect, useCallback } from 'react';

interface UsePWAReturn {
  state: PWAState;
  promptInstall: () => Promise<boolean>;
  applyUpdate: () => void;
  subscribeToPush: () => Promise<void>;
}

export function usePWA(): UsePWAReturn {
  const [pwaState, setPwaState] = useState<PWAState>({ ...state });

  useEffect(() => {
    // Register listener
    const handleChange = (newState: PWAState) => {
      setPwaState(newState);
    };

    listeners.add(handleChange);

    // Initialize
    registerServiceWorker();
    initInstallPrompt();
    initOnlineDetection();

    return () => {
      listeners.delete(handleChange);
    };
  }, []);

  const handlePromptInstall = useCallback(async () => {
    return promptInstall();
  }, []);

  const handleApplyUpdate = useCallback(() => {
    applyUpdate();
  }, []);

  const handleSubscribeToPush = useCallback(async () => {
    await subscribeToPush();
  }, []);

  return {
    state: pwaState,
    promptInstall: handlePromptInstall,
    applyUpdate: handleApplyUpdate,
    subscribeToPush: handleSubscribeToPush,
  };
}

// =========================================================================
// Initialization
// =========================================================================

/**
 * Initialize PWA features
 */
export function initPWA(): void {
  if (typeof window === 'undefined') return;

  registerServiceWorker();
  initInstallPrompt();
  initOnlineDetection();

  console.log('[PWA] Initialized');
}

export default {
  registerServiceWorker,
  applyUpdate,
  initInstallPrompt,
  promptInstall,
  subscribeToPush,
  initOnlineDetection,
  initPWA,
  usePWA,
};
