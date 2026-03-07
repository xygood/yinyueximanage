import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, send_from_directory
from flask_cors import CORS
from config import config
from models.database import init_db
from routes import api_bp
from websocket_handlers import init_socketio

def create_app(env='development'):
    app = Flask(__name__, static_folder='../dist')
    
    current_config = config.get(env, config['default'])
    app.config.from_object(current_config)
    
    CORS(
    app,
    resources={
        r"/api/*": {"origins": "*", "expose_headers": ["Content-Disposition"]},
        r"/socket.io/*": {"origins": "*"},
    },
)
    
    app.register_blueprint(api_bp)
    
    init_db()
    
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve_static(path):
        if path and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, 'index.html')
    
    return app

if __name__ == '__main__':
    env = os.environ.get('FLASK_ENV', 'development')
    app = create_app(env)
    socketio = init_socketio(app)
    
    port = int(os.environ.get('PORT', 5000))
    debug = env == 'development'
    
    print(f"Starting server on port {port} (env: {env})")
    socketio.run(app, host='0.0.0.0', port=port, debug=debug, allow_unsafe_werkzeug=True)
