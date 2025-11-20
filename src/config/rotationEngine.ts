/**
 * Rotation Engine Configuration
 * 
 * This module provides access to the local rotation-engine directory path.
 * Set VITE_ROTATION_ENGINE_ROOT in your .env file to point to your local repo.
 * 
 * Example:
 *   VITE_ROTATION_ENGINE_ROOT="/Users/zstoc/rotation-engine"
 */

export const ROTATION_ENGINE_ROOT = import.meta.env.VITE_ROTATION_ENGINE_ROOT;

export function getRotationEngineRoot(): string | undefined {
  return ROTATION_ENGINE_ROOT;
}

export function isRotationEngineConfigured(): boolean {
  return !!ROTATION_ENGINE_ROOT && ROTATION_ENGINE_ROOT.length > 0;
}
