#!/bin/bash
#
# Quant Engine Control Script
# Manages the launchd service for auto-start/restart
#

PLIST_NAME="com.quantengine.app"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_PATH="$HOME/Library/Logs/quant-engine.log"
ERROR_LOG="$HOME/Library/Logs/quant-engine-error.log"

case "$1" in
    start)
        echo "Starting Quant Engine..."
        launchctl load "$PLIST_PATH" 2>/dev/null
        launchctl start "$PLIST_NAME"
        echo "Started. Check status with: $0 status"
        ;;

    stop)
        echo "Stopping Quant Engine..."
        launchctl stop "$PLIST_NAME" 2>/dev/null
        launchctl unload "$PLIST_PATH" 2>/dev/null
        # Also kill any orphaned processes
        pkill -f "electron ." 2>/dev/null
        pkill -f "quant-engine.*vite" 2>/dev/null
        echo "Stopped."
        ;;

    restart)
        echo "Restarting Quant Engine..."
        $0 stop
        sleep 3
        $0 start
        ;;

    status)
        echo "=== Quant Engine Status ==="
        if launchctl list | grep -q "$PLIST_NAME"; then
            echo "Service: LOADED"
            PID=$(launchctl list | grep "$PLIST_NAME" | awk '{print $1}')
            if [ "$PID" != "-" ] && [ -n "$PID" ]; then
                echo "PID: $PID (running)"
            else
                echo "PID: Not running (will restart)"
            fi
        else
            echo "Service: NOT LOADED"
        fi
        echo ""
        echo "Electron processes:"
        pgrep -fl "electron.*quant-engine" || echo "  None running"
        echo ""
        echo "Vite processes:"
        pgrep -fl "vite.*quant-engine" || echo "  None running"
        ;;

    logs)
        echo "=== Recent Logs (last 50 lines) ==="
        tail -50 "$LOG_PATH" 2>/dev/null || echo "No logs yet"
        ;;

    errors)
        echo "=== Recent Errors (last 50 lines) ==="
        tail -50 "$ERROR_LOG" 2>/dev/null || echo "No errors"
        ;;

    follow)
        echo "=== Following logs (Ctrl+C to stop) ==="
        tail -f "$LOG_PATH" "$ERROR_LOG"
        ;;

    install)
        echo "Installing Quant Engine service..."
        # Ensure log directory exists
        mkdir -p "$HOME/Library/Logs"
        # Load the plist
        launchctl load "$PLIST_PATH"
        echo "Installed. Service will start on login."
        echo "Start now with: $0 start"
        ;;

    uninstall)
        echo "Uninstalling Quant Engine service..."
        $0 stop
        launchctl unload "$PLIST_PATH" 2>/dev/null
        echo "Uninstalled. Service will not start on login."
        ;;

    *)
        echo "Quant Engine Control"
        echo ""
        echo "Usage: $0 {command}"
        echo ""
        echo "Commands:"
        echo "  start     - Start the application"
        echo "  stop      - Stop the application"
        echo "  restart   - Restart the application"
        echo "  status    - Show service status"
        echo "  logs      - Show recent logs"
        echo "  errors    - Show recent errors"
        echo "  follow    - Follow logs in real-time"
        echo "  install   - Install as login service"
        echo "  uninstall - Remove login service"
        exit 1
        ;;
esac
