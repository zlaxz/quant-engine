/**
 * usePythonAPI - Generic hook for Python API calls
 * Wraps fetch to http://localhost:5001 with loading/error states
 */

import { useState, useEffect, useCallback } from 'react';

const PYTHON_API_URL = 'http://localhost:5001';

interface UsePythonAPIOptions {
  pollInterval?: number;
  enabled?: boolean;
}

interface UsePythonAPIResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isConnected: boolean;
  refetch: () => Promise<void>;
}

export function usePythonAPI<T>(
  endpoint: string,
  options: UsePythonAPIOptions = {}
): UsePythonAPIResult<T> {
  const { pollInterval, enabled = true } = options;
  
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const fetchData = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${PYTHON_API_URL}${endpoint}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      setData(result);
      setIsConnected(true);
      setError(null);
    } catch (err) {
      setIsConnected(false);
      setError(err instanceof Error ? err.message : 'Failed to connect to Python API');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [endpoint, enabled]);

  useEffect(() => {
    fetchData();

    if (pollInterval && enabled) {
      const interval = setInterval(fetchData, pollInterval);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [fetchData, pollInterval, enabled]);

  return { data, loading, error, isConnected, refetch: fetchData };
}

// Mutation helper for POST/PUT/DELETE
export async function pythonAPICall<T>(
  endpoint: string,
  method: 'POST' | 'PUT' | 'DELETE' = 'POST',
  body?: unknown
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await fetch(`${PYTHON_API_URL}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json() as T;
    return { data: result, error: null };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'API call failed';
    return { data: null, error: errorMessage };
  }
}
