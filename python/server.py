#!/usr/bin/env python3
"""
Quant Engine HTTP Server
========================
Unified HTTP API for the rotation-engine backtesting system.

Usage:
    python -m python.server
    # or from python/ directory:
    python server.py

Endpoints:
    GET  /health              - Health check
    GET  /regimes             - Get regime heatmap (query: start_date, end_date)
    POST /regimes             - Get regime classification (legacy)
    GET  /strategies          - List all strategies
    GET  /strategies/<id>     - Get strategy card
    POST /backtest            - Run a backtest
    POST /simulate            - Run scenario simulation
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import os
import re
from datetime import datetime

# Import from unified engine package
from engine.api.routes import get_api, QuantEngineAPI


class QuantEngineHandler(BaseHTTPRequestHandler):
    """HTTP request handler for quant engine API."""

    # Strategy ID pattern: /strategies/profile_1, /strategies/profile_2, etc.
    STRATEGY_PATTERN = re.compile(r'^/strategies/([a-zA-Z0-9_-]+)$')

    def __init__(self, *args, **kwargs):
        self.api: QuantEngineAPI = get_api()
        super().__init__(*args, **kwargs)

    def do_POST(self):
        """Handle POST requests."""
        path = urlparse(self.path).path

        if path == '/backtest':
            self._handle_backtest()
        elif path == '/regimes':
            self._handle_regimes_post()
        elif path == '/simulate':
            self._handle_simulate()
        elif path == '/health':
            self._handle_health()
        else:
            self._send_json_response({'error': 'Not found'}, 404)

    def do_GET(self):
        """Handle GET requests."""
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == '/health':
            self._handle_health()
        elif path == '/regimes':
            self._handle_regimes_get(query)
        elif path == '/strategies':
            self._handle_strategies_list()
        elif self.STRATEGY_PATTERN.match(path):
            match = self.STRATEGY_PATTERN.match(path)
            strategy_id = match.group(1)
            self._handle_strategy_card(strategy_id)
        else:
            self._send_json_response({'error': 'Not found'}, 404)

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def _send_cors_headers(self):
        """Add CORS headers to response."""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _send_json_response(self, data: dict, status: int = 200):
        """Send JSON response with proper headers."""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_json_body(self) -> dict:
        """Read and parse JSON request body."""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        return json.loads(body) if body else {}

    # ==================== ENDPOINT HANDLERS ====================

    def _handle_health(self):
        """Health check endpoint."""
        self._send_json_response({
            'status': 'healthy',
            'engine': 'quant-engine',
            'version': '2.1.0',
            'timestamp': datetime.utcnow().isoformat(),
            'endpoints': [
                'GET  /health',
                'GET  /regimes?start_date=&end_date=',
                'POST /regimes',
                'GET  /strategies',
                'GET  /strategies/<id>',
                'POST /backtest',
                'POST /simulate'
            ]
        })

    def _handle_regimes_get(self, query: dict):
        """
        GET /regimes - Regime heatmap with query params.

        Query params:
            start_date: YYYY-MM-DD (default: 30 days ago)
            end_date: YYYY-MM-DD (default: today)
        """
        # Extract query params with defaults
        today = datetime.now()
        default_start = (today - timedelta(days=30)).strftime('%Y-%m-%d')
        default_end = today.strftime('%Y-%m-%d')

        start_date = query.get('start_date', [default_start])[0]
        end_date = query.get('end_date', [default_end])[0]

        print(f"[Regimes GET] {start_date} to {end_date}")

        result = self.api.get_regime_heatmap(start_date, end_date)

        if result.get('success'):
            self._send_json_response(result)
        else:
            self._send_json_response(result, 400)

    def _handle_regimes_post(self):
        """
        POST /regimes - Legacy regime classification endpoint.

        Request body:
            {
                "start_date": "2023-01-01",
                "end_date": "2023-12-31"
            }
        """
        try:
            request = self._read_json_body()
            start_date = request.get('start_date', '2023-01-01')
            end_date = request.get('end_date', '2023-12-31')

            print(f"[Regimes POST] {start_date} to {end_date}")

            result = self.api.get_regime_heatmap(start_date, end_date)

            if result.get('success'):
                self._send_json_response(result)
            else:
                self._send_json_response(result, 400)

        except Exception as e:
            print(f"[Regimes] Error: {e}")
            self._send_json_response({'success': False, 'error': str(e)}, 500)

    def _handle_strategies_list(self):
        """
        GET /strategies - List all available strategies.
        """
        print("[Strategies] Listing all strategies")
        result = self.api.list_strategies()
        self._send_json_response(result)

    def _handle_strategy_card(self, strategy_id: str):
        """
        GET /strategies/<id> - Get strategy card with details.
        """
        print(f"[Strategy] Getting card for: {strategy_id}")
        result = self.api.get_strategy_card(strategy_id)

        if result.get('success'):
            self._send_json_response(result)
        else:
            self._send_json_response(result, 404)

    def _handle_backtest(self):
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
            request = self._read_json_body()
            print(f"[Backtest] Received request: {request.get('strategy_key', 'unknown')}")

            # Extract parameters
            strategy_key = request.get('strategy_key', 'profile_1')
            params = request.get('params', {})
            start_date = params.get('startDate', '2023-01-01')
            end_date = params.get('endDate', '2023-12-31')
            capital = params.get('capital', 100000)

            result = self.api.run_backtest(strategy_key, start_date, end_date, capital)

            if result.get('success'):
                self._send_json_response(result)
                print(f"[Backtest] Completed successfully")
            else:
                self._send_json_response(result, 400)

        except Exception as e:
            print(f"[Backtest] Error: {e}")
            self._send_json_response({'success': False, 'error': str(e)}, 500)

    def _handle_simulate(self):
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
            request = self._read_json_body()
            print(f"[Simulate] Scenario: {request.get('scenario', 'unknown')}")

            result = self.api.run_simulation(request)

            if result.get('success'):
                self._send_json_response(result)
            else:
                self._send_json_response(result, 400)

        except Exception as e:
            print(f"[Simulate] Error: {e}")
            self._send_json_response({'success': False, 'error': str(e)}, 500)

    def log_message(self, format, *args):
        """Suppress default HTTP logging."""
        pass


# Import timedelta for default date calculation
from datetime import timedelta


def run_server(port: int = 5000):
    """Start the quant engine HTTP server."""
    server_address = ('', port)
    httpd = HTTPServer(server_address, QuantEngineHandler)

    print("=" * 60)
    print("Quant Engine HTTP Server v2.1")
    print("=" * 60)
    print(f"Listening on http://localhost:{port}")
    print(f"Working directory: {os.getcwd()}")
    print("\nEndpoints:")
    print("  GET  /health                     - Health check")
    print("  GET  /regimes?start_date=&end_date= - Regime heatmap")
    print("  POST /regimes                    - Regime classification (legacy)")
    print("  GET  /strategies                 - List all strategies")
    print("  GET  /strategies/<id>            - Get strategy card")
    print("  POST /backtest                   - Run backtest")
    print("  POST /simulate                   - Run scenario simulation")
    print("\nScenarios for /simulate:")
    print("  - vix_shock: params.vix_increase (percentage)")
    print("  - price_drop: params.drop_pct (percentage)")
    print("  - vol_crush: params.vol_drop (percentage)")
    print("\nPress Ctrl+C to stop\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.shutdown()


if __name__ == '__main__':
    run_server()
