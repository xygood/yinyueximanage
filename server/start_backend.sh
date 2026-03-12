#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
export FLASK_ENV=production
# 明确监听所有网卡，避免本机/局域网无法连接
export HOST=0.0.0.0
python3 app.py
