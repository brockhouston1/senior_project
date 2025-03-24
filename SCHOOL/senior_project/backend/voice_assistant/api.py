from flask import Flask
from flask_cors import CORS
from .openai_assistant import openai_api

def create_app():
    """Create and configure the Flask application"""
    app = Flask(__name__)
    CORS(app)

    # Register the OpenAI API blueprint
    app.register_blueprint(openai_api)

    return app 