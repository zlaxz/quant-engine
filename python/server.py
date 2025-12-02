#!/usr/bin/env python3
"""
Quant Engine HTTP Server (Flask)
================================
RESTful API for the rotation-engine backtesting system.

Usage:
    cd python/
    python server.py
    # or: flask run --port 5000

Endpoints:
    GET  /health              - Health check and version
    GET  /regimes             - Regime heatmap (query: start_date, end_date)
    POST /backtest            - Run a backtest
    GET  /strategies          - List all strategies
    GET  /strategies/<id>     - Get strategy card
    GET  /discovery           - Discovery matrix (strategies x regimes)
    POST /simulate            - Run scenario simulation
"""

import os
from datetime import datetime, timedelta
from flask import Flask, jsonify, request
from flask_cors import CORS

# Import business logic from routes module
from engine.api.routes import get_api, STRATEGY_CATALOG, REGIME_DESCRIPTIONS

# Create Flask app
app = Flask(__name__)

# Enable CORS for React frontend
CORS(app, resources={r"/*": {"origins": "*"}})

# Engine version
ENGINE_VERSION = "2.2.0"


# =============================================================================
# ENDPOINTS
# =============================================================================

@app.route('/health', methods=['GET', 'POST'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'engine': 'quant-engine',
        'version': ENGINE_VERSION,
        'timestamp': datetime.utcnow().isoformat(),
        'endpoints': [
            'GET  /health',
            'GET  /regimes?start_date=&end_date=',
            'POST /backtest',
            'GET  /strategies',
            'GET  /strategies/<id>',
            'GET  /discovery',
            'POST /simulate',
            'GET  /plugins',
            'POST /plugins/reload',
            'GET  /analysis/<plugin_name>'
        ]
    })


@app.route('/regimes', methods=['GET'])
def get_regimes():
    """
    GET /regimes - Regime heatmap with query params.

    Query params:
        start_date: YYYY-MM-DD (default: 30 days ago)
        end_date: YYYY-MM-DD (default: today)
    """
    today = datetime.now()
    default_start = (today - timedelta(days=30)).strftime('%Y-%m-%d')
    default_end = today.strftime('%Y-%m-%d')

    start_date = request.args.get('start_date', default_start)
    end_date = request.args.get('end_date', default_end)

    print(f"[Regimes GET] {start_date} to {end_date}")

    api = get_api()
    result = api.get_regime_heatmap(start_date, end_date)

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 400


@app.route('/backtest', methods=['POST'])
def run_backtest():
    """
    POST /backtest - Run strategy backtest.

    Request body:
        {
            "strategy_key": "profile_1",
            "params": {
                "startDate": "2023-01-01",
                "endDate": "2023-12-31",
                "capital": 100000
            }
        }
    """
    try:
        data = request.get_json() or {}
        print(f"[Backtest] Received request: {data.get('strategy_key', 'unknown')}")

        strategy_key = data.get('strategy_key', 'profile_1')
        params = data.get('params', {})
        start_date = params.get('startDate', '2023-01-01')
        end_date = params.get('endDate', '2023-12-31')
        capital = params.get('capital', 100000)

        # ========== PREDICTIVE INTERCEPTOR ==========
        # Check causal memory for known failure patterns
        try:
            import subprocess
            import json as json_lib

            interceptor_task = f"""Check if strategy '{strategy_key}' has historical failures in period {start_date} to {end_date}.

Return JSON: {{"risk_level": "HIGH|MEDIUM|LOW", "mechanism": "why", "evidence": "data"}}
If no risk: {{"risk_level": "LOW"}}"""

            result_check = subprocess.run(
                ['python3', 'scripts/deepseek_agent.py', interceptor_task, 'analyst'],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=os.path.dirname(os.path.abspath(__file__))
            )

            if result_check.returncode == 0:
                try:
                    risk = json_lib.loads(result_check.stdout)
                    if risk.get('risk_level') == 'HIGH':
                        print(f"⚠️  PREDICTIVE INTERVENTION: High risk for {strategy_key}")
                        print(f"    Mechanism: {risk.get('mechanism')}")
                except: pass
        except Exception as e:
            print(f"[Interceptor] Check failed: {e}")
        # ========== END INTERCEPTOR ==========

        api = get_api()
        result = api.run_backtest(strategy_key, start_date, end_date, capital)

        if result.get('success'):
            print("[Backtest] Completed successfully")
            return jsonify(result)
        else:
            return jsonify(result), 400

    except Exception as e:
        print(f"[Backtest] Error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/strategies', methods=['GET'])
def list_strategies():
    """GET /strategies - List all available strategies."""
    print("[Strategies] Listing all strategies")
    api = get_api()
    result = api.list_strategies()
    return jsonify(result)


@app.route('/strategies/<strategy_id>', methods=['GET'])
def get_strategy(strategy_id):
    """GET /strategies/<id> - Get strategy card with details."""
    print(f"[Strategy] Getting card for: {strategy_id}")
    api = get_api()
    result = api.get_strategy_card(strategy_id)

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 404


@app.route('/discovery', methods=['GET'])
def get_discovery():
    """
    GET /discovery - Discovery Matrix.

    Returns a matrix showing which strategies are optimal for each regime,
    providing coverage analysis across all market states.
    """
    print("[Discovery] Generating discovery matrix")
    api = get_api()
    result = api.get_discovery_matrix()
    return jsonify(result)


@app.route('/simulate', methods=['POST'])
def run_simulation():
    """
    POST /simulate - Run scenario simulation.

    Request body:
        {
            "scenario": "vix_shock",
            "params": {
                "vix_increase": 50
            },
            "portfolio": {
                "profile_1": 0.15,
                "profile_2": 0.25
            }
        }

    Supported scenarios:
        - vix_shock: Simulate VIX spike
        - price_drop: Simulate market crash
        - vol_crush: Simulate volatility collapse
    """
    try:
        data = request.get_json() or {}
        print(f"[Simulate] Scenario: {data.get('scenario', 'unknown')}")

        api = get_api()
        result = api.run_simulation(data)

        if result.get('success'):
            return jsonify(result)
        else:
            return jsonify(result), 400

    except Exception as e:
        print(f"[Simulate] Error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# =============================================================================
# PLUGIN ENDPOINTS
# =============================================================================

@app.route('/plugins', methods=['GET'])
def list_plugins():
    """
    GET /plugins - List all available analysis plugins.

    Returns all dynamically loaded QuantModule plugins with their metadata.
    """
    print("[Plugins] Listing available plugins")
    api = get_api()
    result = api.list_plugins()
    return jsonify(result)


@app.route('/plugins/reload', methods=['POST'])
def reload_plugins():
    """
    POST /plugins/reload - Hot reload plugins from disk.

    Scans engine/plugins/ directory and reloads all QuantModule implementations.
    Use this after adding or modifying plugins without restarting the server.
    """
    print("[Plugins] Hot reloading plugins from disk")
    api = get_api()
    result = api.reload_plugins()
    return jsonify(result)


@app.route('/analysis/<plugin_name>', methods=['GET'])
def run_analysis(plugin_name):
    """
    GET /analysis/<plugin_name> - Execute a dynamically loaded plugin.

    Query params:
        start_date: YYYY-MM-DD (optional, defaults to 90 days ago)
        end_date: YYYY-MM-DD (optional, defaults to today)
        ... any plugin-specific parameters

    Example:
        GET /analysis/volatility_analyzer?start_date=2024-01-01&end_date=2024-03-01&window=20
    """
    print(f"[Analysis] Running plugin: {plugin_name}")

    # Extract query params
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    # Collect all other params for the plugin
    params = {k: v for k, v in request.args.items()
              if k not in ['start_date', 'end_date']}

    # Convert numeric params
    for key, value in params.items():
        try:
            if '.' in value:
                params[key] = float(value)
            else:
                params[key] = int(value)
        except (ValueError, TypeError):
            pass  # Keep as string

    api = get_api()
    result = api.run_plugin(plugin_name, params, start_date, end_date)

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 404 if 'not found' in str(result.get('error', '')).lower() else 400


# =============================================================================
# MAIN
# =============================================================================

def run_server(port: int = 5000, debug: bool = False):
    """Start the quant engine Flask server."""
    print("=" * 60)
    print(f"Quant Engine HTTP Server v{ENGINE_VERSION}")
    print("=" * 60)
    print(f"Listening on http://localhost:{port}")
    print(f"Working directory: {os.getcwd()}")
    print("\nEndpoints:")
    print("  GET  /health                        - Health check")
    print("  GET  /regimes?start_date=&end_date= - Regime heatmap")
    print("  POST /backtest                      - Run backtest")
    print("  GET  /strategies                    - List all strategies")
    print("  GET  /strategies/<id>               - Get strategy card")
    print("  GET  /discovery                     - Discovery matrix")
    print("  POST /simulate                      - Run scenario simulation")
    print("\nPlugin System:")
    print("  GET  /plugins                       - List available plugins")
    print("  POST /plugins/reload                - Hot reload plugins")
    print("  GET  /analysis/<name>               - Run analysis plugin")
    print("\nScenarios for /simulate:")
    print("  - vix_shock: params.vix_increase (percentage)")
    print("  - price_drop: params.drop_pct (percentage)")
    print("  - vol_crush: params.vol_drop (percentage)")
    print("\nPress Ctrl+C to stop\n")

    app.run(host='0.0.0.0', port=port, debug=debug)


if __name__ == '__main__':
    run_server()
