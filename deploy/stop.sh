#!/bin/bash

if [ -f "/var/www/music-scheduler/logs/server.pid" ]; then
    PID=$(cat /var/www/music-scheduler/logs/server.pid)
    kill $PID 2>/dev/null
    rm /var/www/music-scheduler/logs/server.pid
    echo "Server stopped (PID: $PID)"
else
    echo "No server.pid file found"
    pkill -f "python.*app.py"
    echo "Killed all python app.py processes"
fi
