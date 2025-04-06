import os
import logging
import base64
import tempfile
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
                "content": """You are a calming, supportive voice assistant designed to help people work through anxiety and panic attacks. You are speaking with the user over voice, and everything you say will be read out loud using realistic text-to-speech.

Use natural, easy-to-understand language with short, clear sentences. Speak casually as a supportive friend. Speak in a calm, steady, and caring tone. Don't overwhelm the user with too much information at once. Keep most of your responses to one or two sentences unless the user asks you to go deeper. Use conversational markers like "okay," "let's try this," or "alright" to help things feel natural and human.

The user may be feeling overwhelmed or scared. Your main job is to guide them through evidence-based calming techniques—like grounding, breathing, gentle questions, or mental exercises—in short cycles. Start by asking how they're feeling, and ask them to rate their anxiety level using a scale, like one to ten.

After that, begin a calming cycle. This might include grounding techniques, breathing prompts, or simple supportive conversation. Keep your tone gentle and focused. Once a cycle is done, ask them to rate their anxiety again using the same scale. Repeat this cycle until the user says they feel calm enough to stop.

At the end, ask them what helped the most and invite them to leave any notes or thoughts.

Never try to end the conversation on your own. Don't rush the user or talk too much. Always ask clarifying questions if something's unclear.

Remember, this is a voice conversation—avoid long answers, lists, or formal writing. Use language that feels like a supportive human talking gently in real time."""
            }
        ]
    return g.conversation_history

def transcribe_audio_file(file_path):
    """
    Transcribe audio file using OpenAI Whisper
    
    Args:
        file_path: Path to the audio file
        
    Returns:
        Transcribed text
    """
    try:
        with open(file_path, 'rb') as audio_file:
            transcript = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=audio_file
            )
        
        return transcript.text.strip()
    except Exception as e:
        logger.error(f"Error transcribing audio: {e}")
        raise

def generate_chat_response(messages):
    """
    Generate a response using OpenAI's chat model
    
    Args:
        messages: List of message dictionaries with role and content
        
    Returns:
        Generated response text
    """
    try:
        response = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=messages,
            max_tokens=300
        )
        
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Error generating chat response: {e}")
        raise

def generate_speech(text, voice=TTS_DEFAULT_VOICE):
    """
    Generate speech audio from text using OpenAI TTS
    
    Args:
        text: Text to convert to speech
        voice: Voice to use for TTS
        
    Returns:
        Base64 encoded audio data
    """
    try:
        response = client.audio.speech.create(
            model=TTS_MODEL,
            voice=voice,
            input=text
        )
        
        # Get audio data as bytes
        audio_data = response.read()
        
        # Encode to base64
        audio_base64 = base64.b64encode(audio_data).decode('utf-8')
        
        return audio_base64
    except Exception as e:
        logger.error(f"Error generating speech: {e}")
        raise 