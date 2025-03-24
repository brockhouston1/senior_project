import os
import logging
import base64
import tempfile
import json
from flask import Blueprint, request, jsonify, g
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Check if OPENAI_API_KEY is present
openai_api_key = os.environ.get("OPENAI_API_KEY")
if openai_api_key:
    logger.info(f"OPENAI_API_KEY present: True (Length: {len(openai_api_key)})")
else:
    logger.error("OPENAI_API_KEY is missing!")

# Initialize the OpenAI client
client = OpenAI(api_key=openai_api_key)

# Define constants
CHAT_MODEL = "gpt-4o-mini"  # Using GPT-4o mini for faster, cost-effective responses
TTS_MODEL = "tts-1"
TTS_DEFAULT_VOICE = "alloy"  # Available voices: alloy, echo, fable, onyx, nova, shimmer
WHISPER_MODEL = "whisper-1"

# Create a blueprint for the OpenAI API routes
openai_api = Blueprint('openai_api', __name__, url_prefix='/api/openai')

@openai_api.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint to verify the API is running
    """
    try:
        # Check if OpenAI API key is present
        if not openai_api_key:
            return jsonify({
                "status": "error",
                "message": "OpenAI API key not configured"
            }), 500
        
        return jsonify({
            "status": "ok",
            "message": "API is healthy"
        })
    except Exception as e:
        logger.error(f"Health check error: {e}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

def get_conversation_history():
    """Get the conversation history for the current context"""
    if not hasattr(g, 'conversation_history'):
        g.conversation_history = [
            {
                "role": "system", 
                "content": "You are a helpful voice assistant named Aid. You provide helpful, concise, and friendly responses. Keep your answers brief and to the point since this is a voice conversation."
            }
        ]
    return g.conversation_history

@openai_api.route('/transcribe', methods=['POST'])
def transcribe_audio():
    """
    Transcribe audio using OpenAI Whisper
    """
    try:
        data = request.json
        if not data or 'audio_data' not in data:
            return jsonify({"success": False, "error": "No audio data provided"}), 400
        
        audio_base64 = data['audio_data']
        file_format = data.get('file_format', 'wav')  # Default to WAV format
        
        # Decode base64 audio
        audio_bytes = base64.b64decode(audio_base64)
        
        # Create a temporary file to store the audio
        with tempfile.NamedTemporaryFile(suffix=f'.{file_format}', delete=False) as temp_file:
            temp_file_path = temp_file.name
            temp_file.write(audio_bytes)
        
        logger.info(f"Temporary audio file created at: {temp_file_path} with format: {file_format}")
        
        try:
            # Use OpenAI's Whisper model for transcription
            with open(temp_file_path, 'rb') as audio_file:
                transcript = client.audio.transcriptions.create(
                    model=WHISPER_MODEL,
                    file=audio_file
                )
            
            transcribed_text = transcript.text.strip()
            logger.info(f"Transcription: {transcribed_text}")
            
            return jsonify({
                "success": True,
                "text": transcribed_text
            })
            
        finally:
            # Clean up the temporary file
            try:
                os.unlink(temp_file_path)
                logger.info(f"Temporary file {temp_file_path} deleted")
            except Exception as e:
                logger.warning(f"Error deleting temporary file: {e}")
    
    except Exception as e:
        logger.error(f"Error transcribing audio: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@openai_api.route('/chat', methods=['POST'])
def chat():
    """
    Process a chat message and return a response with text and audio
    """
    try:
        logger.info("Received chat request")
        data = request.json
        if not data or 'message' not in data:
            logger.error("No message provided in chat request")
            return jsonify({"success": False, "error": "No message provided"}), 400
        
        user_message = data['message']
        voice = data.get('voice', TTS_DEFAULT_VOICE)
        
        logger.info(f"Received chat message: {user_message}")
        
        # Get conversation history for this context
        conversation_history = get_conversation_history()
        
        # Add user message to history
        conversation_history.append({"role": "user", "content": user_message})
        
        # Get response from OpenAI
        logger.info(f"Sending message to OpenAI using model {CHAT_MODEL}")
        try:
            response = client.chat.completions.create(
                model=CHAT_MODEL,
                messages=conversation_history,
                max_tokens=300
            )
            
            assistant_message = response.choices[0].message.content.strip()
            logger.info(f"Assistant response: {assistant_message}")
            
            # Add assistant response to history
            conversation_history.append({"role": "assistant", "content": assistant_message})
            
            # Limit history length to prevent tokens from exceeding limits
            if len(conversation_history) > 10:
                # Keep the first message (system prompt) and the most recent 9 messages
                conversation_history = conversation_history[:1] + conversation_history[-9:]
            
            # Generate speech from the response
            logger.info("Generating speech for assistant response")
            try:
                audio_base64 = generate_speech(assistant_message, voice)
                logger.info("Successfully generated speech")
                
                return jsonify({
                    "success": True,
                    "text": assistant_message,
                    "audio": audio_base64
                })
            except Exception as tts_error:
                logger.error(f"Error generating speech: {tts_error}")
                # Still return the text response even if speech generation fails
                return jsonify({
                    "success": True,
                    "text": assistant_message,
                    "audio": None,
                    "tts_error": str(tts_error)
                })
                
        except Exception as openai_error:
            logger.error(f"OpenAI API error: {openai_error}")
            return jsonify({"success": False, "error": f"OpenAI API error: {str(openai_error)}"}), 500
    
    except Exception as e:
        logger.error(f"Error in chat endpoint: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@openai_api.route('/tts', methods=['POST'])
def text_to_speech():
    """
    Convert text to speech using OpenAI TTS
    """
    try:
        data = request.json
        if not data or 'text' not in data:
            return jsonify({"success": False, "error": "No text provided"}), 400
        
        text = data['text']
        voice = data.get('voice', TTS_DEFAULT_VOICE)
        
        audio_base64 = generate_speech(text, voice)
        
        return jsonify({
            "success": True,
            "audio": audio_base64
        })
    
    except Exception as e:
        logger.error(f"Error in TTS: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@openai_api.route('/start', methods=['POST'])
def start_conversation():
    """
    Start a new conversation with a greeting
    """
    try:
        data = request.json
        voice = data.get('voice', TTS_DEFAULT_VOICE)
        
        # Initialize new conversation history
        g.conversation_history = [
            {
                "role": "system", 
                "content": "You are a helpful voice assistant named Aid. You provide helpful, concise, and friendly responses. Keep your answers brief and to the point since this is a voice conversation."
            }
        ]
        
        # Generate greeting message
        greeting = "Hello! I'm Aid, your voice assistant. How can I help you today?"
        
        # Add assistant greeting to history
        g.conversation_history.append({"role": "assistant", "content": greeting})
        
        # Generate speech for greeting
        audio_base64 = generate_speech(greeting, voice)
        
        return jsonify({
            "success": True,
            "text": greeting,
            "audio": audio_base64
        })
    
    except Exception as e:
        logger.error(f"Error starting conversation: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@openai_api.route('/end', methods=['POST'])
def end_conversation():
    """
    End the current conversation with a farewell
    """
    try:
        data = request.json
        voice = data.get('voice', TTS_DEFAULT_VOICE)
        
        # Generate farewell message
        farewell = "Thank you for chatting with me. Have a great day!"
        
        # Clear conversation history
        if hasattr(g, 'conversation_history'):
            g.conversation_history = None
        
        # Generate speech for farewell
        audio_base64 = generate_speech(farewell, voice)
        
        return jsonify({
            "success": True,
            "text": farewell,
            "audio": audio_base64
        })
    
    except Exception as e:
        logger.error(f"Error ending conversation: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


def generate_speech(text, voice=TTS_DEFAULT_VOICE):
    """
    Generate speech from text using OpenAI TTS
    
    Args:
        text (str): The text to convert to speech
        voice (str): The voice to use for TTS
    
    Returns:
        str: Base64-encoded audio data
    """
    try:
        logger.info(f"Generating speech for text: '{text}' with voice: {voice}")
        
        # Create a temp file to store the audio
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
            temp_file_path = temp_file.name
        
        # Generate speech with OpenAI TTS
        response = client.audio.speech.create(
            model=TTS_MODEL,
            voice=voice,
            input=text
        )
        
        # Save to the temp file
        response.stream_to_file(temp_file_path)
        
        # Read the audio file and convert to base64
        with open(temp_file_path, "rb") as audio_file:
            audio_data = audio_file.read()
            audio_base64 = base64.b64encode(audio_data).decode('utf-8')
        
        # Clean up the temp file
        try:
            os.unlink(temp_file_path)
        except Exception as e:
            logger.warning(f"Error deleting temporary file: {e}")
        
        return audio_base64
    
    except Exception as e:
        logger.error(f"Error generating speech: {e}")
        raise 