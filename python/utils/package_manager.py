#!/usr/bin/env python3
"""
Secure Package Manager for Chief Quant
======================================
Allows the AI to install Python packages autonomously with safety checks.

Security Features:
- Only allows standard PyPI package names (no URLs, paths, or git repos)
- Validates package names against regex pattern
- Updates requirements.txt automatically
- Returns full stdout/stderr for transparency

Usage:
    from utils.package_manager import install_package, list_packages, check_package

    result = install_package("scipy")
    result = install_package("scikit-learn>=1.0.0")
"""

import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

# Path to requirements.txt (relative to python/ directory)
REQUIREMENTS_PATH = Path(__file__).parent.parent / "requirements.txt"

# Regex for valid PyPI package names
# Allows: package, package==1.0.0, package>=1.0.0, package[extra], etc.
# Blocks: URLs, file paths, git repos
VALID_PACKAGE_PATTERN = re.compile(
    r'^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?'  # Package name
    r'(\[[a-zA-Z0-9,_-]+\])?'                      # Optional extras like [dev,test]
    r'([<>=!~]+[0-9a-zA-Z.*,<>=!~]+)?$'            # Optional version specifier
)

# Blocklist patterns (security)
BLOCKED_PATTERNS = [
    r'https?://',      # HTTP URLs
    r'git\+',          # Git URLs
    r'git://',         # Git protocol
    r'file://',        # File URLs
    r'^/',             # Absolute paths
    r'^\.',            # Relative paths
    r'\\',             # Windows paths
    r'\.\.',           # Parent directory traversal
    r';',              # Command injection
    r'&&',             # Command chaining
    r'\|',             # Pipe
    r'\$',             # Variable expansion
    r'`',              # Command substitution
]

# Allowlist of known safe packages (optional extra validation)
KNOWN_SAFE_PACKAGES = {
    # Data Science
    'numpy', 'pandas', 'scipy', 'scikit-learn', 'statsmodels',
    # Visualization
    'matplotlib', 'seaborn', 'plotly', 'altair',
    # Finance
    'yfinance', 'pandas-ta', 'ta-lib', 'quantlib', 'arch',
    'pyfolio', 'empyrical', 'cvxpy', 'cvxopt',
    # ML/Deep Learning
    'torch', 'tensorflow', 'keras', 'xgboost', 'lightgbm', 'catboost',
    # Data
    'pyarrow', 'polars', 'dask', 'vaex',
    # HTTP/API
    'requests', 'httpx', 'aiohttp', 'websockets',
    # Database
    'sqlalchemy', 'psycopg2', 'asyncpg', 'redis',
    # Utils
    'tqdm', 'joblib', 'numba', 'cython',
    # Testing
    'pytest', 'hypothesis',
}


def validate_package_name(package: str) -> Dict[str, Any]:
    """
    Validate a package name for security.

    Returns:
        {
            'valid': bool,
            'package': str (normalized),
            'error': str or None,
            'warning': str or None
        }
    """
    # Strip whitespace
    package = package.strip()

    if not package:
        return {'valid': False, 'package': package, 'error': 'Empty package name'}

    # Check for blocked patterns (security)
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, package):
            return {
                'valid': False,
                'package': package,
                'error': f'Blocked pattern detected: {pattern}. Only PyPI package names allowed.'
            }

    # Validate against allowed pattern
    if not VALID_PACKAGE_PATTERN.match(package):
        return {
            'valid': False,
            'package': package,
            'error': f'Invalid package name format. Must be a valid PyPI package name.'
        }

    # Extract base package name (without version specifier)
    base_name = re.split(r'[<>=!\[]', package)[0].lower()

    # Check if it's a known safe package (warning only, not blocking)
    warning = None
    if base_name not in KNOWN_SAFE_PACKAGES:
        warning = f"Package '{base_name}' not in known safe list. Proceeding anyway."

    return {
        'valid': True,
        'package': package,
        'base_name': base_name,
        'error': None,
        'warning': warning
    }


def install_package(package: str, upgrade: bool = False) -> Dict[str, Any]:
    """
    Securely install a Python package from PyPI.

    Args:
        package: Package name (e.g., "scipy", "pandas>=2.0.0", "scikit-learn[dev]")
        upgrade: If True, upgrade existing package

    Returns:
        {
            'success': bool,
            'package': str,
            'stdout': str,
            'stderr': str,
            'requirements_updated': bool,
            'error': str or None
        }
    """
    # Validate package name
    validation = validate_package_name(package)
    if not validation['valid']:
        return {
            'success': False,
            'package': package,
            'stdout': '',
            'stderr': '',
            'requirements_updated': False,
            'error': validation['error']
        }

    # Build pip command
    cmd = [sys.executable, '-m', 'pip', 'install']
    if upgrade:
        cmd.append('--upgrade')
    cmd.append(package)

    # Execute pip install
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )

        success = result.returncode == 0

        # Update requirements.txt if successful
        requirements_updated = False
        if success:
            requirements_updated = _update_requirements(package, validation.get('base_name', package))

        return {
            'success': success,
            'package': package,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'requirements_updated': requirements_updated,
            'error': None if success else f'pip exited with code {result.returncode}',
            'warning': validation.get('warning')
        }

    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'package': package,
            'stdout': '',
            'stderr': 'Installation timed out after 5 minutes',
            'requirements_updated': False,
            'error': 'Timeout'
        }
    except Exception as e:
        return {
            'success': False,
            'package': package,
            'stdout': '',
            'stderr': str(e),
            'requirements_updated': False,
            'error': str(e)
        }


def _update_requirements(package: str, base_name: str) -> bool:
    """
    Update requirements.txt with the new package.

    Returns True if updated, False if already present or error.
    """
    try:
        # Read existing requirements
        existing = set()
        existing_lines = []

        if REQUIREMENTS_PATH.exists():
            with open(REQUIREMENTS_PATH, 'r') as f:
                for line in f:
                    stripped = line.strip()
                    if stripped and not stripped.startswith('#'):
                        # Extract base package name
                        pkg_base = re.split(r'[<>=!\[]', stripped)[0].lower()
                        existing.add(pkg_base)
                    existing_lines.append(line)

        # Check if package already in requirements
        if base_name.lower() in existing:
            return False  # Already present

        # Append new package
        with open(REQUIREMENTS_PATH, 'a') as f:
            # Add newline if file doesn't end with one
            if existing_lines and not existing_lines[-1].endswith('\n'):
                f.write('\n')
            f.write(f'\n# Added by Chief Quant on {datetime.now().strftime("%Y-%m-%d")}\n')
            f.write(f'{package}\n')

        return True

    except Exception:
        return False


def uninstall_package(package: str) -> Dict[str, Any]:
    """
    Uninstall a Python package.

    Args:
        package: Package name to uninstall

    Returns:
        {
            'success': bool,
            'package': str,
            'stdout': str,
            'stderr': str,
            'error': str or None
        }
    """
    # Validate package name (same security checks)
    validation = validate_package_name(package)
    if not validation['valid']:
        return {
            'success': False,
            'package': package,
            'stdout': '',
            'stderr': '',
            'error': validation['error']
        }

    # Build pip command
    cmd = [sys.executable, '-m', 'pip', 'uninstall', '-y', package]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )

        return {
            'success': result.returncode == 0,
            'package': package,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'error': None if result.returncode == 0 else f'pip exited with code {result.returncode}'
        }

    except Exception as e:
        return {
            'success': False,
            'package': package,
            'stdout': '',
            'stderr': str(e),
            'error': str(e)
        }


def check_package(package: str) -> Dict[str, Any]:
    """
    Check if a package is installed and get its version.

    Args:
        package: Package name to check

    Returns:
        {
            'installed': bool,
            'package': str,
            'version': str or None,
            'location': str or None
        }
    """
    # Validate package name
    validation = validate_package_name(package)
    if not validation['valid']:
        return {
            'installed': False,
            'package': package,
            'version': None,
            'location': None,
            'error': validation['error']
        }

    base_name = validation.get('base_name', package)

    cmd = [sys.executable, '-m', 'pip', 'show', base_name]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            return {
                'installed': False,
                'package': package,
                'version': None,
                'location': None
            }

        # Parse pip show output
        info = {}
        for line in result.stdout.split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                info[key.strip().lower()] = value.strip()

        return {
            'installed': True,
            'package': package,
            'version': info.get('version'),
            'location': info.get('location')
        }

    except Exception as e:
        return {
            'installed': False,
            'package': package,
            'version': None,
            'location': None,
            'error': str(e)
        }


def list_packages() -> Dict[str, Any]:
    """
    List all installed packages.

    Returns:
        {
            'success': bool,
            'packages': [{'name': str, 'version': str}, ...],
            'count': int
        }
    """
    cmd = [sys.executable, '-m', 'pip', 'list', '--format=json']

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode != 0:
            return {
                'success': False,
                'packages': [],
                'count': 0,
                'error': result.stderr
            }

        import json
        packages = json.loads(result.stdout)

        return {
            'success': True,
            'packages': packages,
            'count': len(packages)
        }

    except Exception as e:
        return {
            'success': False,
            'packages': [],
            'count': 0,
            'error': str(e)
        }


def sync_requirements() -> Dict[str, Any]:
    """
    Install all packages from requirements.txt.

    Returns:
        {
            'success': bool,
            'stdout': str,
            'stderr': str,
            'packages_installed': int
        }
    """
    if not REQUIREMENTS_PATH.exists():
        return {
            'success': False,
            'stdout': '',
            'stderr': f'requirements.txt not found at {REQUIREMENTS_PATH}',
            'packages_installed': 0
        }

    cmd = [sys.executable, '-m', 'pip', 'install', '-r', str(REQUIREMENTS_PATH)]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600  # 10 minute timeout for full sync
        )

        # Count installed packages from output
        installed_count = result.stdout.count('Successfully installed')

        return {
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'packages_installed': installed_count
        }

    except Exception as e:
        return {
            'success': False,
            'stdout': '',
            'stderr': str(e),
            'packages_installed': 0
        }


# CLI interface for testing
if __name__ == '__main__':
    import argparse
    import json

    parser = argparse.ArgumentParser(description='Secure Package Manager')
    parser.add_argument('action', choices=['install', 'uninstall', 'check', 'list', 'sync'])
    parser.add_argument('package', nargs='?', help='Package name')
    parser.add_argument('--upgrade', '-U', action='store_true', help='Upgrade package')

    args = parser.parse_args()

    if args.action == 'install':
        if not args.package:
            print('Error: package name required for install')
            sys.exit(1)
        result = install_package(args.package, upgrade=args.upgrade)
    elif args.action == 'uninstall':
        if not args.package:
            print('Error: package name required for uninstall')
            sys.exit(1)
        result = uninstall_package(args.package)
    elif args.action == 'check':
        if not args.package:
            print('Error: package name required for check')
            sys.exit(1)
        result = check_package(args.package)
    elif args.action == 'list':
        result = list_packages()
    elif args.action == 'sync':
        result = sync_requirements()

    print(json.dumps(result, indent=2))
