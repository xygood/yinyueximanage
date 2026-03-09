#!/bin/bash

cd /var/www/music-scheduler/server

if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate

pip install -r requirements.txt

if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "Please edit .env file with your database credentials"
    exit 1
fi

mkdir -p ../logs
nohup python app.py > ../logs/server.log 2>&1 &
echo $! > ../logs/server.pid

echo "Server started on port 5000"
echo "PID: $(cat ../logs/server.pid)"
