#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
export FLASK_ENV=production
python3 app.py
