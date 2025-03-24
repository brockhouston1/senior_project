import os
from dotenv import load_dotenv
from voice_assistant.api import create_app

# Load environment variables from .env file
env_path = os.path.join(os.path.dirname(__file__), '.env')
print(f"Loading .env file from: {env_path}")
load_dotenv(env_path)

# Create the Flask application
app = create_app()

if __name__ == '__main__':
    # For local development
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=True) 