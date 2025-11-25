#!/usr/bin/env python3
"""
Rotation Engine Bridge Server
Lightweight HTTP server that executes rotation-engine backtests and returns results.

Usage:
    python bridge_server.py

Then leave it running in the background while you work in the Quant Chat interface.
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import subprocess
import sys
import os
import threading
from pathlib import Path
from datetime import datetime

class BridgeHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        """Handle backtest execution requests"""
        if self.path == '/backtest':
            try:
                # Read request body
                content_length = int(self.headers['Content-Length'])
                body = self.rfile.read(content_length)
                request = json.loads(body)
                
                print(f"📊 Received backtest request: {request.get('strategy_key', 'unknown')}")
                
                # Extract parameters
                strategy_key = request.get('strategy_key')
                params = request.get('params', {})
                start_date = params.get('startDate')
                end_date = params.get('endDate')
                capital = params.get('capital', 100000)
                
                # Build command to execute rotation-engine
                # Adjust this command based on your actual rotation-engine CLI
                cmd = [
                    'python', '-m', 'rotation_engine.cli',
                    'backtest',
                    '--profile', strategy_key,
                    '--start', start_date,
                    '--end', end_date,
                    '--capital', str(capital),
                    '--output', 'json'
                ]
                
                print(f"🚀 Executing: {' '.join(cmd)}")
                
                # Execute backtest
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300,  # 5 minute timeout
                    cwd=os.path.dirname(os.path.abspath(__file__))
                )
                
                if result.returncode == 0:
                    # Parse JSON output from rotation-engine
                    output = json.loads(result.stdout)
                    
                    response = {
                        'success': True,
                        'metrics': output.get('metrics', {}),
                        'equity_curve': output.get('equity_curve', []),
                        'trades': output.get('trades', []),
                        'engine_source': 'rotation-engine-bridge'
                    }
                    
                    print(f"✅ Backtest completed successfully")
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(response).encode())
                else:
                    # Execution failed
                    error_msg = result.stderr or 'Unknown error'
                    print(f"❌ Backtest failed: {error_msg}")
                    
                    response = {
                        'success': False,
                        'error': error_msg
                    }
                    
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(response).encode())
                    
            except subprocess.TimeoutExpired:
                print("⏱️ Backtest timed out after 5 minutes")
                self.send_response(408)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'Backtest timed out after 5 minutes'
                }).encode())
                
            except Exception as e:
                print(f"💥 Error: {str(e)}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': str(e)
                }).encode())
        
        elif self.path == '/health':
            # Health check endpoint
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'healthy',
                'engine': 'rotation-engine-bridge',
                'version': '1.0.0'
            }).encode())

        elif self.path == '/ingest-data':
            # Trigger Massive.com data ingestion in background
            try:
                content_length = int(self.headers['Content-Length'])
                body = self.rfile.read(content_length)
                request = json.loads(body)

                date = request.get('date')  # YYYY-MM-DD
                tickers = request.get('tickers', [])  # List of symbols
                data_type = request.get('type', 'stocks_trades')

                if not date:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'success': False,
                        'error': 'date parameter required (YYYY-MM-DD)'
                    }).encode())
                    return

                print(f"📥 Starting data ingestion for {date}, type={data_type}")
                print(f"   Tickers: {tickers if tickers else 'DEFAULT'}")

                # Build ingestor command
                script_dir = Path(__file__).parent
                cmd = [
                    sys.executable,
                    str(script_dir / 'data_ingestor.py'),
                    '--date', date,
                    '--type', data_type
                ]

                if tickers:
                    cmd.extend(['--tickers', ','.join(tickers)])

                # Run in background thread
                def run_ingestor():
                    try:
                        result = subprocess.run(
                            cmd,
                            capture_output=True,
                            text=True,
                            timeout=3600,  # 1 hour timeout for large downloads
                            cwd=script_dir
                        )
                        if result.returncode == 0:
                            print(f"✅ Ingestion completed for {date}")
                        else:
                            print(f"❌ Ingestion failed: {result.stderr}")
                    except subprocess.TimeoutExpired:
                        print(f"⏱️ Ingestion timed out for {date}")
                    except Exception as e:
                        print(f"💥 Ingestion error: {e}")

                thread = threading.Thread(target=run_ingestor, daemon=True)
                thread.start()

                # Respond immediately (ingestion runs in background)
                self.send_response(202)  # Accepted
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'message': f'Data ingestion started for {date}',
                    'date': date,
                    'data_type': data_type,
                    'tickers': tickers if tickers else 'DEFAULT',
                    'status': 'processing'
                }).encode())

            except Exception as e:
                print(f"💥 Ingest endpoint error: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': str(e)
                }).encode())

        else:
            self.send_response(404)
            self.end_headers()
    
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def log_message(self, format, *args):
        """Suppress default HTTP logging"""
        pass

def run_server(port=8080):
    """Start the bridge server"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, BridgeHandler)
    
    print("=" * 60)
    print("🌉 Rotation Engine Bridge Server")
    print("=" * 60)
    print(f"📡 Listening on http://localhost:{port}")
    print(f"📁 Working directory: {os.getcwd()}")
    print("\n✨ Ready to execute backtests from Chief Quant")
    print("🛑 Press Ctrl+C to stop\n")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\n👋 Shutting down bridge server...")
        httpd.shutdown()

if __name__ == '__main__':
    # Change to rotation-engine directory if script is in subdirectory
    script_dir = Path(__file__).parent
    engine_root = script_dir.parent if script_dir.name == 'rotation-engine-bridge' else script_dir
    os.chdir(engine_root)
    
    run_server()
