from flask import Flask, Blueprint, request, Response, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
import logging
import os
from .openai_assistant import openai_api
from . import socketio  # Import socketio from the package

# Create a logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create voice assistant blueprint
voice_assistant_api = Blueprint('voice_assistant_api', __name__)

# Create Socket.IO instance
# socketio = SocketIO()  # Remove this line as we're importing socketio

def create_app():
    """Create and configure the Flask application"""
    app = Flask(__name__, static_folder='../static')
    CORS(app)
    
    # Configure app
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev_key')
    
    # Register the OpenAI API blueprint
    app.register_blueprint(openai_api)
    
    # Register the voice assistant blueprint
    app.register_blueprint(voice_assistant_api)
    
    # Initialize Socket.IO with the app
    socketio.init_app(app, cors_allowed_origins="*", async_mode='eventlet')
    
    # Import WebSocket handlers
    from . import websocket_server
    
    # Route for test client
    @app.route('/test')
    def test_client():
        return send_from_directory(app.static_folder, 'test_websocket.html')
    
    # Route for WebRTC test client
    @app.route('/test-webrtc')
    def test_webrtc():
        return send_from_directory(app.static_folder, 'test_webrtc.html')

    @app.route('/test-media')
    def test_media_page():
        return send_from_directory(app.static_folder, 'test_media.html')
    
    # Simple health check endpoint
    @app.route('/health')
    def app_health_check():
        return {
            "status": "ok",
            "message": "Voice Assistant API is operational"
        }
    
    return app

@voice_assistant_api.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint for the voice assistant API"""
    return {
        "status": "ok",
        "message": "Voice Assistant API is operational"
    } 