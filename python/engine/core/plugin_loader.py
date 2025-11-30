#!/usr/bin/env python3
"""
Plugin Registry and Dynamic Loader
==================================
Scans engine/plugins/ recursively and loads modules implementing QuantModule.

Usage:
    from engine.core.plugin_loader import get_registry

    registry = get_registry()

    # List all plugins
    plugins = registry.list_plugins()

    # Get a specific plugin
    plugin = registry.get('volatility_analyzer')
    result = plugin.run(df, params={'window': 20})

    # Reload plugins (hot reload)
    registry.reload()
"""

import importlib
import importlib.util
import inspect
import sys
from pathlib import Path
from typing import Dict, Any, Optional, List, Type
import logging

from .interfaces import QuantModule

logger = logging.getLogger(__name__)


class PluginRegistry:
    """
    Registry for dynamically loaded QuantModule plugins.

    Scans the plugins directory on initialization and maintains
    a registry of available analysis modules.
    """

    def __init__(self, plugins_dir: Optional[Path] = None):
        """
        Initialize the registry and scan for plugins.

        Args:
            plugins_dir: Path to plugins directory. Defaults to
                        engine/plugins/ relative to this file.
        """
        if plugins_dir is None:
            # Default: engine/plugins/ (sibling to engine/core/)
            plugins_dir = Path(__file__).parent.parent / 'plugins'

        self.plugins_dir = plugins_dir
        self._plugins: Dict[str, QuantModule] = {}
        self._load_errors: Dict[str, str] = {}

        # Initial scan
        self.reload()

    def reload(self) -> Dict[str, Any]:
        """
        Rescan plugins directory and reload all plugins.

        Returns:
            Dict with reload results:
            {
                'loaded': ['plugin1', 'plugin2'],
                'errors': {'bad_plugin': 'Error message'},
                'total': 2
            }
        """
        self._plugins.clear()
        self._load_errors.clear()

        if not self.plugins_dir.exists():
            logger.warning(f"Plugins directory does not exist: {self.plugins_dir}")
            self.plugins_dir.mkdir(parents=True, exist_ok=True)
            return {'loaded': [], 'errors': {}, 'total': 0}

        loaded = []

        # Scan recursively for .py files
        for py_file in self.plugins_dir.rglob('*.py'):
            # Skip __init__.py and private files
            if py_file.name.startswith('_'):
                continue

            try:
                plugin = self._load_plugin_file(py_file)
                if plugin:
                    self._plugins[plugin.name] = plugin
                    loaded.append(plugin.name)
                    logger.info(f"Loaded plugin: {plugin.name} v{plugin.version}")
            except Exception as e:
                error_msg = f"{type(e).__name__}: {str(e)}"
                self._load_errors[str(py_file.relative_to(self.plugins_dir))] = error_msg
                logger.error(f"Failed to load {py_file}: {error_msg}")

        return {
            'loaded': loaded,
            'errors': self._load_errors,
            'total': len(loaded)
        }

    def _load_plugin_file(self, py_file: Path) -> Optional[QuantModule]:
        """
        Load a single plugin file and extract QuantModule subclass.

        Args:
            py_file: Path to Python file

        Returns:
            Instantiated QuantModule or None if not a valid plugin
        """
        # Create unique module name to avoid conflicts
        module_name = f"quant_plugin_{py_file.stem}_{id(py_file)}"

        # Load module from file
        spec = importlib.util.spec_from_file_location(module_name, py_file)
        if spec is None or spec.loader is None:
            return None

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module

        try:
            spec.loader.exec_module(module)
        except Exception as e:
            # Clean up on failure
            del sys.modules[module_name]
            raise

        # Find QuantModule subclasses in the module
        plugin_class = None
        for name, obj in inspect.getmembers(module, inspect.isclass):
            if (issubclass(obj, QuantModule) and
                obj is not QuantModule and
                obj.__module__ == module_name):
                plugin_class = obj
                break

        if plugin_class is None:
            return None

        # Validate required attributes
        instance = plugin_class()
        if not instance.name:
            raise ValueError(f"Plugin {py_file.name} has no 'name' attribute")

        return instance

    def get(self, name: str) -> Optional[QuantModule]:
        """
        Get a plugin by name.

        Args:
            name: Plugin name (as defined in plugin's name attribute)

        Returns:
            QuantModule instance or None if not found
        """
        return self._plugins.get(name)

    def list_plugins(self) -> List[Dict[str, Any]]:
        """
        List all loaded plugins with their metadata.

        Returns:
            List of plugin info dicts
        """
        return [plugin.get_info() for plugin in self._plugins.values()]

    def has(self, name: str) -> bool:
        """Check if a plugin exists."""
        return name in self._plugins

    def get_errors(self) -> Dict[str, str]:
        """Get any plugin loading errors."""
        return self._load_errors.copy()

    @property
    def count(self) -> int:
        """Number of loaded plugins."""
        return len(self._plugins)

    def __contains__(self, name: str) -> bool:
        return self.has(name)

    def __len__(self) -> int:
        return self.count


# Singleton instance
_registry_instance: Optional[PluginRegistry] = None


def get_registry() -> PluginRegistry:
    """
    Get or create the global plugin registry singleton.

    Returns:
        PluginRegistry instance
    """
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = PluginRegistry()
    return _registry_instance


def reload_plugins() -> Dict[str, Any]:
    """
    Reload all plugins (convenience function).

    Returns:
        Reload results dict
    """
    return get_registry().reload()
