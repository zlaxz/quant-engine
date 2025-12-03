/**
 * usePythonHealth - Global Python API health monitor
 * Polls /health every 10 seconds and exposes connection status
 */

import { useState, useEffect, useCallback } from 'react';

const PYTHON_API_URL = 'http://localhost:5001';
const POLL_INTERVAL = 10000; // 10 seconds

interface HealthStatus {
  isOnline: boolean;
  lastChecked: string | null;
  latencyMs: number | null;
  version: string | null;
  error: string | null;
}

export function usePythonHealth(): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>({
    isOnline: false,
    lastChecked: null,
    latencyMs: null,
    version: null,
    error: null,
  });

  const checkHealth = useCallback(async () => {
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${PYTHON_API_URL}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        setStatus({
          isOnline: true,
          lastChecked: new Date().toISOString(),
          latencyMs,
          version: data.version || null,
          error: null,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      setStatus({
        isOnline: false,
        lastChecked: new Date().toISOString(),
        latencyMs: null,
        version: null,
        error: err instanceof Error ? err.message : 'Connection failed',
      });
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return status;
}
