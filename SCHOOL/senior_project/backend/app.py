import os
import logging
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables from .env file
env_path = os.path.join(os.path.dirname(__file__), '.env')
logger.info(f"Loading .env file from: {env_path}")
load_dotenv(env_path)

# Check for OpenAI API key
if not os.getenv("OPENAI_API_KEY"):
    logger.warning("OPENAI_API_KEY environment variable not set. Please set it in the .env file.")

try:
    from voice_assistant.api import create_app, socketio
    # Create the Flask application
    app = create_app()
except ImportError as e:
    logger.error(f"Failed to import voice_assistant.api: {e}")
    raise

if __name__ == '__main__':
    # For local development
    port = int(os.environ.get('PORT', 5001))
    
    # Run with Socket.IO
    logger.info(f"Starting server with Socket.IO on port {port}")
    socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True) 