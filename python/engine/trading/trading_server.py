"""
Trading Server - Flask API for Multi-Account Live Trading
==========================================================

Supports dual IBKR accounts (paper + live) running simultaneously.

Account Endpoints:
- GET  /api/trading/accounts           - List all configured accounts
- POST /api/trading/accounts           - Add a new account
- DELETE /api/trading/accounts/<name>  - Remove an account
- POST /api/trading/accounts/<name>/connect    - Connect specific account
- POST /api/trading/accounts/<name>/disconnect - Disconnect specific account
- POST /api/trading/connect-all        - Connect all accounts
- POST /api/trading/disconnect-all     - Disconnect all accounts

Trading Endpoints (account parameter optional, uses active if not specified):
- GET  /api/trading/status             - Get connection status for all accounts
- GET  /api/trading/positions          - Get positions (per-account or aggregated)
- GET  /api/trading/quote/<sym>        - Get quote
- POST /api/trading/order              - Submit order (specify account)
- POST /api/trading/cancel             - Cancel order
- POST /api/trading/kill-switch        - Emergency flatten (specific or all)
- GET  /api/trading/stats              - Get trading stats
- GET  /api/trading/daily-pnl          - Get daily P&L

Usage:
    python -m engine.trading.trading_server --port 5002
"""

import asyncio
import logging
import os
from datetime import datetime
from typing import Optional
from flask import Flask, jsonify, request
from flask_cors import CORS

# Trading components
from .ibkr_client import TradingMode, FUTURES_SPECS
from .account_manager import IBKRAccountManager, create_dual_account_manager
from .order_manager import OrderPriority

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("AlphaFactory.TradingServer")

app = Flask(__name__)
CORS(app)

# Global state
_account_manager: Optional[IBKRAccountManager] = None


def get_event_loop():
    """Get or create event loop."""
    try:
        return asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop


def run_async(coro):
    """Run async function in sync context."""
    loop = get_event_loop()
    return loop.run_until_complete(coro)


def get_manager() -> IBKRAccountManager:
    """Get account manager, creating if needed."""
    global _account_manager
    if _account_manager is None:
        _account_manager = IBKRAccountManager()
    return _account_manager


# =============================================================================
# Account Management Endpoints
# =============================================================================

@app.route('/api/trading/accounts', methods=['GET'])
def list_accounts():
    """List all configured accounts."""
    manager = get_manager()
    return jsonify({
        'success': True,
        'accounts': manager.list_accounts(),
        'activeAccount': manager.active_account,
    })


@app.route('/api/trading/accounts', methods=['POST'])
def add_account():
    """Add a new account configuration."""
    manager = get_manager()

    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Missing account data'}), 400

        name = data.get('name')
        if not name:
            return jsonify({'success': False, 'error': 'Account name required'}), 400

        mode_str = data.get('mode', 'paper').lower()
        mode = TradingMode.LIVE if mode_str == 'live' else TradingMode.PAPER

        success = manager.add_account(
            name=name,
            mode=mode,
            host=data.get('host', '127.0.0.1'),
            port=data.get('port'),
            client_id=data.get('clientId'),
            max_position_per_symbol=data.get('maxPositionPerSymbol', 10),
            daily_loss_limit=data.get('dailyLossLimit', 500.0),
        )

        if not success:
            return jsonify({'success': False, 'error': f'Account {name} already exists'}), 400

        return jsonify({
            'success': True,
            'message': f'Account {name} added',
            'accounts': manager.list_accounts(),
        })

    except Exception as e:
        logger.error(f"Add account error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/accounts/<name>', methods=['DELETE'])
def remove_account(name: str):
    """Remove an account configuration."""
    manager = get_manager()

    success = manager.remove_account(name)
    if not success:
        return jsonify({
            'success': False,
            'error': f'Cannot remove account {name}. Disconnect first or not found.'
        }), 400

    return jsonify({
        'success': True,
        'message': f'Account {name} removed',
        'accounts': manager.list_accounts(),
    })


@app.route('/api/trading/accounts/<name>/connect', methods=['POST'])
def connect_account(name: str):
    """Connect a specific account."""
    manager = get_manager()

    try:
        success = run_async(manager.connect_account(name))

        if not success:
            account = manager.get_account(name)
            error = account.last_error if account else f'Account {name} not found'
            return jsonify({'success': False, 'error': error}), 500

        return jsonify({
            'success': True,
            'message': f'Account {name} connected',
            'accounts': manager.list_accounts(),
        })

    except Exception as e:
        logger.error(f"Connect account error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/accounts/<name>/disconnect', methods=['POST'])
def disconnect_account(name: str):
    """Disconnect a specific account."""
    manager = get_manager()

    try:
        success = run_async(manager.disconnect_account(name))

        return jsonify({
            'success': success,
            'message': f'Account {name} disconnected' if success else f'Failed to disconnect {name}',
            'accounts': manager.list_accounts(),
        })

    except Exception as e:
        logger.error(f"Disconnect account error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/accounts/active', methods=['POST'])
def set_active_account():
    """Set the active account."""
    manager = get_manager()

    try:
        data = request.get_json()
        name = data.get('name') if data else None

        if not name:
            return jsonify({'success': False, 'error': 'Account name required'}), 400

        success = manager.set_active_account(name)

        return jsonify({
            'success': success,
            'activeAccount': manager.active_account,
        })

    except Exception as e:
        logger.error(f"Set active account error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/connect-all', methods=['POST'])
def connect_all():
    """Connect all configured accounts."""
    manager = get_manager()

    try:
        results = run_async(manager.connect_all())

        return jsonify({
            'success': all(results.values()),
            'results': results,
            'accounts': manager.list_accounts(),
        })

    except Exception as e:
        logger.error(f"Connect all error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/disconnect-all', methods=['POST'])
def disconnect_all():
    """Disconnect all accounts."""
    manager = get_manager()

    try:
        results = run_async(manager.disconnect_all())

        return jsonify({
            'success': True,
            'results': results,
            'accounts': manager.list_accounts(),
        })

    except Exception as e:
        logger.error(f"Disconnect all error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# =============================================================================
# Legacy Connection Endpoints (backwards compatible)
# =============================================================================

@app.route('/api/trading/connect', methods=['POST'])
def connect():
    """Connect to IBKR (legacy - creates 'default' account if needed)."""
    manager = get_manager()

    try:
        data = request.get_json() or {}
        mode_str = data.get('mode', 'paper').lower()
        mode = TradingMode.LIVE if mode_str == 'live' else TradingMode.PAPER
        account_name = data.get('account', mode_str)  # Use mode as default name

        # Add account if not exists
        if account_name not in [a['name'] for a in manager.list_accounts()]:
            manager.add_account(name=account_name, mode=mode)

        # Connect
        success = run_async(manager.connect_account(account_name))

        if not success:
            account = manager.get_account(account_name)
            error = account.last_error if account else 'Connection failed'
            return jsonify({
                'success': False,
                'error': f'Failed to connect. Is TWS/Gateway running? {error}'
            }), 500

        logger.info(f"✅ Connected to IBKR ({mode_str})")

        return jsonify({
            'success': True,
            'mode': mode_str,
            'account': account_name,
            'message': f'Connected to IBKR in {mode_str} mode'
        })

    except Exception as e:
        logger.error(f"Connection failed: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/disconnect', methods=['POST'])
def disconnect():
    """Disconnect from IBKR (legacy - disconnects active or specified account)."""
    manager = get_manager()

    try:
        data = request.get_json() or {}
        account_name = data.get('account', manager.active_account)

        if account_name:
            run_async(manager.disconnect_account(account_name))

        logger.info(f"Disconnected from IBKR ({account_name})")

        return jsonify({
            'success': True,
            'message': f'Disconnected from IBKR ({account_name})'
        })

    except Exception as e:
        logger.error(f"Disconnect error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/status', methods=['GET'])
def get_status():
    """Get connection status for all accounts."""
    manager = get_manager()

    accounts = manager.list_accounts()
    any_connected = any(a['is_connected'] for a in accounts)

    return jsonify({
        'connected': any_connected,
        'accounts': accounts,
        'activeAccount': manager.active_account,
        'availableSymbols': list(FUTURES_SPECS.keys())
    })


# =============================================================================
# Position Endpoints
# =============================================================================

@app.route('/api/trading/positions', methods=['GET'])
def get_positions():
    """Get positions (per-account or aggregated)."""
    manager = get_manager()

    try:
        account_name = request.args.get('account')
        aggregate = request.args.get('aggregate', 'false').lower() == 'true'

        if aggregate:
            # Aggregated positions across all accounts
            positions = manager.get_aggregated_positions()
            return jsonify({
                'success': True,
                'aggregated': True,
                'positions': {s: {
                    'symbol': p.symbol,
                    'quantity': p.quantity,
                    'avg_cost': p.avg_cost,
                    'unrealized_pnl': p.unrealized_pnl,
                    'realized_pnl': p.realized_pnl,
                    'market_value': p.market_value,
                } for s, p in positions.items()},
            })

        elif account_name:
            # Specific account
            positions = manager.get_positions(account_name)
            return jsonify({
                'success': True,
                'account': account_name,
                'positions': {s: {
                    'symbol': p.symbol,
                    'quantity': p.quantity,
                    'avg_cost': p.avg_cost,
                    'unrealized_pnl': p.unrealized_pnl,
                    'realized_pnl': p.realized_pnl,
                    'market_value': p.market_value,
                } for s, p in positions.items()},
            })

        else:
            # All accounts
            all_positions = manager.get_all_positions()
            return jsonify({
                'success': True,
                'positionsByAccount': {
                    acct: {s: {
                        'symbol': p.symbol,
                        'quantity': p.quantity,
                        'avg_cost': p.avg_cost,
                        'unrealized_pnl': p.unrealized_pnl,
                        'realized_pnl': p.realized_pnl,
                        'market_value': p.market_value,
                    } for s, p in positions.items()}
                    for acct, positions in all_positions.items()
                },
            })

    except Exception as e:
        logger.error(f"Get positions error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/quote/<symbol>', methods=['GET'])
def get_quote(symbol: str):
    """Get quote for a symbol."""
    manager = get_manager()

    try:
        account_name = request.args.get('account')
        quote = run_async(manager.get_quote(symbol.upper(), account_name))

        if not quote:
            return jsonify({
                'success': False,
                'error': f'No quote available for {symbol}'
            }), 404

        return jsonify({
            'success': True,
            'quote': {
                'symbol': quote.symbol,
                'bid': quote.bid,
                'ask': quote.ask,
                'last': quote.last,
                'mid': quote.mid,
                'spread': quote.spread,
                'volume': quote.volume,
                'timestamp': quote.timestamp.isoformat()
            }
        })

    except Exception as e:
        logger.error(f"Get quote error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# =============================================================================
# Order Endpoints
# =============================================================================

@app.route('/api/trading/order', methods=['POST'])
def submit_order():
    """Submit an order to a specific account."""
    manager = get_manager()

    try:
        data = request.get_json()

        if not data:
            return jsonify({'success': False, 'error': 'Missing order data'}), 400

        # Required fields
        symbol = data.get('symbol')
        side = data.get('side')
        quantity = data.get('quantity')

        if not all([symbol, side, quantity]):
            return jsonify({
                'success': False,
                'error': 'Missing required fields: symbol, side, quantity'
            }), 400

        # Account selection (optional, uses active if not specified)
        account_name = data.get('account')

        # Optional fields
        order_type = data.get('orderType', 'LIMIT')
        limit_price = data.get('limitPrice')
        stop_price = data.get('stopPrice')
        time_in_force = data.get('timeInForce', 'GTC')
        strategy_name = data.get('strategyName', 'manual')
        dry_run = data.get('dryRun', False)

        # Parse priority
        priority_str = data.get('priority', 'NORMAL')
        priority = OrderPriority[priority_str.upper()] if priority_str else OrderPriority.NORMAL

        # Submit order
        result = run_async(manager.place_order(
            account_name=account_name,
            symbol=symbol.upper(),
            side=side.upper(),
            quantity=int(quantity),
            order_type=order_type.upper(),
            limit_price=float(limit_price) if limit_price else None,
            stop_price=float(stop_price) if stop_price else None,
            time_in_force=time_in_force.upper(),
            priority=priority,
            strategy_name=strategy_name,
            dry_run=dry_run,
        ))

        return jsonify({
            'success': result.status.value not in ['error', 'rejected'],
            'account': account_name or manager.active_account,
            'order': result.to_dict()
        })

    except Exception as e:
        logger.error(f"Submit order error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/cancel', methods=['POST'])
def cancel_order():
    """Cancel an order."""
    manager = get_manager()

    try:
        data = request.get_json()
        order_id = data.get('orderId')
        account_name = data.get('account')

        if not order_id:
            return jsonify({'success': False, 'error': 'Missing orderId'}), 400

        success = run_async(manager.cancel_order(account_name, order_id))

        return jsonify({
            'success': success,
            'message': 'Cancel request sent' if success else 'Order not found or account not connected'
        })

    except Exception as e:
        logger.error(f"Cancel order error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/cancel-all', methods=['POST'])
def cancel_all_orders():
    """Cancel all pending orders."""
    manager = get_manager()

    try:
        data = request.get_json() or {}
        account_name = data.get('account')
        symbol = data.get('symbol')

        # TODO: Implement cancel_all in account manager
        # For now, just acknowledge
        return jsonify({
            'success': True,
            'message': 'Cancel all not yet implemented for multi-account'
        })

    except Exception as e:
        logger.error(f"Cancel all error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# =============================================================================
# Kill Switch
# =============================================================================

@app.route('/api/trading/kill-switch', methods=['POST'])
def kill_switch():
    """EMERGENCY: Flatten all positions."""
    manager = get_manager()

    try:
        data = request.get_json() or {}
        account_name = data.get('account')
        reason = data.get('reason', 'Manual trigger from UI')
        flatten_all = data.get('all', False)

        if flatten_all or not account_name:
            # Kill switch ALL accounts
            logger.critical(f"🚨 GLOBAL KILL SWITCH: {reason}")
            results = run_async(manager.kill_switch_all(reason))
        else:
            # Kill switch specific account
            logger.critical(f"🚨 KILL SWITCH on {account_name}: {reason}")
            results = run_async(manager.kill_switch(account_name, reason))

        return jsonify({
            'success': True,
            'account': account_name or 'ALL',
            'results': results
        })

    except Exception as e:
        logger.error(f"Kill switch error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# =============================================================================
# Stats Endpoints
# =============================================================================

@app.route('/api/trading/stats', methods=['GET'])
def get_stats():
    """Get trading statistics."""
    manager = get_manager()

    try:
        account_name = request.args.get('account')

        # Basic stats for now
        accounts = manager.list_accounts()
        connected_accounts = [a for a in accounts if a['is_connected']]

        return jsonify({
            'success': True,
            'stats': {
                'totalAccounts': len(accounts),
                'connectedAccounts': len(connected_accounts),
                'accounts': accounts,
            }
        })

    except Exception as e:
        logger.error(f"Get stats error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/daily-pnl', methods=['GET'])
def get_daily_pnl():
    """Get daily P&L."""
    manager = get_manager()

    try:
        account_name = request.args.get('account')
        aggregate = request.args.get('aggregate', 'false').lower() == 'true'

        if aggregate:
            stats = manager.get_aggregated_daily_pnl()
            return jsonify({
                'success': True,
                'aggregated': True,
                'dailyStats': stats,
            })

        elif account_name:
            stats = manager.get_daily_stats(account_name)
            return jsonify({
                'success': True,
                'account': account_name,
                'dailyStats': stats,
            })

        else:
            all_stats = manager.get_all_daily_stats()
            return jsonify({
                'success': True,
                'statsByAccount': all_stats,
            })

    except Exception as e:
        logger.error(f"Get daily PnL error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/halt', methods=['POST'])
def halt_trading():
    """Halt trading."""
    manager = get_manager()

    try:
        data = request.get_json() or {}
        account_name = data.get('account')
        reason = data.get('reason', 'Manual halt from UI')
        halt_all = data.get('all', False)

        if halt_all or not account_name:
            results = manager.halt_all(reason)
            return jsonify({
                'success': True,
                'results': results,
                'message': f'All trading halted: {reason}'
            })
        else:
            success = manager.halt_trading(account_name, reason)
            return jsonify({
                'success': success,
                'message': f'Trading halted on {account_name}: {reason}'
            })

    except Exception as e:
        logger.error(f"Halt error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trading/resume', methods=['POST'])
def resume_trading():
    """Resume trading."""
    manager = get_manager()

    try:
        data = request.get_json() or {}
        account_name = data.get('account')
        resume_all = data.get('all', False)

        if resume_all or not account_name:
            results = manager.resume_all()
            return jsonify({
                'success': True,
                'results': results,
                'message': 'All trading resumed'
            })
        else:
            success = manager.resume_trading(account_name)
            return jsonify({
                'success': success,
                'message': f'Trading resumed on {account_name}'
            })

    except Exception as e:
        logger.error(f"Resume error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# =============================================================================
# Health Check
# =============================================================================

@app.route('/api/trading/health', methods=['GET'])
def health():
    """Health check endpoint."""
    manager = get_manager()
    accounts = manager.list_accounts()
    any_connected = any(a['is_connected'] for a in accounts)

    return jsonify({
        'status': 'ok',
        'service': 'trading-server',
        'multiAccount': True,
        'totalAccounts': len(accounts),
        'connectedAccounts': sum(1 for a in accounts if a['is_connected']),
        'activeAccount': manager.active_account,
        'timestamp': datetime.now().isoformat()
    })


# =============================================================================
# Setup Convenience Endpoint
# =============================================================================

@app.route('/api/trading/setup-dual', methods=['POST'])
def setup_dual_accounts():
    """Quick setup for paper + live dual account configuration."""
    global _account_manager

    try:
        data = request.get_json() or {}

        paper_client_id = data.get('paperClientId', 1)
        live_client_id = data.get('liveClientId', 2)
        paper_loss_limit = data.get('paperLossLimit', 1000.0)
        live_loss_limit = data.get('liveLossLimit', 500.0)

        _account_manager = run_async(create_dual_account_manager(
            paper_client_id=paper_client_id,
            live_client_id=live_client_id,
            paper_loss_limit=paper_loss_limit,
            live_loss_limit=live_loss_limit,
        ))

        return jsonify({
            'success': True,
            'message': 'Dual account setup complete',
            'accounts': _account_manager.list_accounts(),
        })

    except Exception as e:
        logger.error(f"Setup dual accounts error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# =============================================================================
# Main
# =============================================================================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Multi-Account Trading Server")
    parser.add_argument('--port', type=int, default=5002)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--setup-dual', action='store_true',
                        help='Pre-configure paper + live accounts')

    args = parser.parse_args()

    # Pre-configure dual accounts if requested
    if args.setup_dual:
        global _account_manager
        _account_manager = IBKRAccountManager()
        _account_manager.add_account("paper", TradingMode.PAPER, client_id=1)
        _account_manager.add_account("live", TradingMode.LIVE, client_id=2)
        print("Pre-configured paper + live accounts")

    print(f"""
╔══════════════════════════════════════════════════════════════╗
║         MULTI-ACCOUNT TRADING SERVER                        ║
╠══════════════════════════════════════════════════════════════╣
║  Port: {args.port}                                                  ║
║  Host: {args.host}                                            ║
║                                                              ║
║  DUAL ACCOUNT SUPPORT:                                       ║
║  Paper: TWS Port 7497, client_id=1                           ║
║  Live:  TWS Port 7496, client_id=2                           ║
║                                                              ║
║  Quick Setup:                                                ║
║  POST /api/trading/setup-dual                                ║
║                                                              ║
║  Account Endpoints:                                          ║
║  GET  /api/trading/accounts                                  ║
║  POST /api/trading/accounts/<name>/connect                   ║
║  POST /api/trading/order  (with "account" field)             ║
║  POST /api/trading/kill-switch  ("all": true for global)     ║
╚══════════════════════════════════════════════════════════════╝
""")

    app.run(host=args.host, port=args.port, debug=False)


if __name__ == '__main__':
    main()
