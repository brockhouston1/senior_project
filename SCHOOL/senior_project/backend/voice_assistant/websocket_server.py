"""
WebSocket server for voice assistant real-time communication
"""
import logging
import base64
import json
import tempfile
import os
import time
import traceback
from enum import Enum
from flask import request, session
from flask_socketio import emit, join_room, leave_room, disconnect
from . import socketio
from .openai_assistant import (
    client, 
    transcribe_audio_file, 
    generate_chat_response, 
    generate_speech
)

# Configure logging
logger = logging.getLogger(__name__)

# Keep track of connected clients
connected_clients = {}

# Audio format settings
DEFAULT_SAMPLE_RATE = 24000
DEFAULT_CHANNELS = 1

# Error types for better error handling
class ErrorTypes(Enum):
    NETWORK_ERROR = "network_error"
    AUTH_ERROR = "authentication_error"
    RATE_LIMIT_ERROR = "rate_limit_error"
    API_ERROR = "api_error"
    PROCESSING_ERROR = "processing_error"
    VALIDATION_ERROR = "validation_error"


# Pipeline stages
class PipelineStage(Enum):
    IDLE = "idle"
    RECEIVING = "receiving"
    TRANSCRIBING = "transcription"
    PROCESSING = "llm"
    GENERATING_SPEECH = "tts"
    SENDING = "sending"


@socketio.on('connect')
def handle_connect():
    """Handle new client connections"""
    client_id = request.sid
    logger.info(f"Client connected: {client_id}")
    
    try:
        # Get client information
        user_agent = request.headers.get('User-Agent', 'Unknown')
        ip_address = request.remote_addr
        
        # Initialize client data
        connected_clients[client_id] = {
            'id': client_id,
            'audio_buffer': [],
            'is_processing': False,
            'connection_time': time.time(),
            'last_activity': time.time(),
            'user_agent': user_agent,
            'ip_address': ip_address,
            'reconnection_count': 0,
            'current_stage': PipelineStage.IDLE.value,
            'using_webrtc': False,
            'webrtc_chunks': [],
            'conversation_history': [
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
        }
        
        # Join a private room for this client
        join_room(client_id)
        
        # Send confirmation with session data
        emit('server_status', {
            'status': 'connected',
            'message': 'Successfully connected to voice assistant server',
            'client_id': client_id,
            'session_data': {
                'connection_time': time.strftime('%Y-%m-%d %H:%M:%S', 
                                               time.localtime(connected_clients[client_id]['connection_time'])),
                'server_info': 'Voice Assistant WebSocket Server',
                'webrtc_supported': True
            }
        })
        
        logger.info(f"Client {client_id} successfully initialized")
    
    except Exception as e:
        logger.error(f"Error during client connection: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': 'Failed to initialize client session',
            'details': str(e)
        })


@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    client_id = request.sid
    logger.info(f"Client disconnected: {client_id}")
    
    try:
        # Store client info temporarily for logging
        client_info = connected_clients.get(client_id, {})
        connection_duration = 0
        
        if client_info:
            # Calculate connection duration
            if 'connection_time' in client_info:
                connection_duration = time.time() - client_info['connection_time']
            
            # Log disconnect event with details
            logger.info(f"Client {client_id} disconnected after {connection_duration:.2f} seconds")
            
            # Clean up client data
            del connected_clients[client_id]
        
        # Leave private room
        leave_room(client_id)
        
    except Exception as e:
        logger.error(f"Error during client disconnection: {str(e)}")
        logger.error(traceback.format_exc())


@socketio.on('reconnect')
def handle_reconnect(data):
    """Handle client reconnection attempts"""
    client_id = request.sid
    logger.info(f"Client reconnection attempt: {client_id}")
    
    previous_client_id = data.get('previous_client_id')
    
    try:
        # Check if there's previous session data to restore
        if previous_client_id and previous_client_id in connected_clients:
            # Transfer conversation history and other important data
            previous_data = connected_clients[previous_client_id]
            
            # Create new session with previous data
            connected_clients[client_id] = {
                'id': client_id,
                'audio_buffer': [],
                'is_processing': False,
                'connection_time': time.time(),
                'last_activity': time.time(),
                'user_agent': request.headers.get('User-Agent', 'Unknown'),
                'ip_address': request.remote_addr,
                'reconnection_count': previous_data.get('reconnection_count', 0) + 1,
                'current_stage': PipelineStage.IDLE.value,
                'using_webrtc': False,
                'webrtc_chunks': [],
                'conversation_history': previous_data.get('conversation_history', [
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
                ])
            }
            
            # Clean up old session
            del connected_clients[previous_client_id]
            leave_room(previous_client_id)
            
            # Join new room
            join_room(client_id)
            
            # Notify client of successful reconnection with session restoration
            emit('server_status', {
                'status': 'reconnected',
                'message': 'Successfully reconnected with session restoration',
                'client_id': client_id,
                'session_data': {
                    'reconnection_count': connected_clients[client_id]['reconnection_count'],
                    'conversation_preserved': True
                }
            })
            
            logger.info(f"Client {client_id} successfully reconnected (restored from {previous_client_id})")
        
        else:
            # Handle as new connection if no previous data
            handle_connect()
            
            # Update reconnection count
            if client_id in connected_clients:
                connected_clients[client_id]['reconnection_count'] = 1
            
            # Notify client of reconnection without session restoration
            emit('server_status', {
                'status': 'reconnected',
                'message': 'Reconnected without previous session data',
                'client_id': client_id,
                'session_data': {
                    'reconnection_count': 1,
                    'conversation_preserved': False
                }
            })
            
            logger.info(f"Client {client_id} reconnected as new session")
    
    except Exception as e:
        logger.error(f"Error during client reconnection: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': 'Failed to handle reconnection',
            'details': str(e)
        })


@socketio.on('ping')
def handle_ping():
    """Handle ping requests to check connection health"""
    client_id = request.sid
    
    try:
        if client_id in connected_clients:
            # Update last activity timestamp
            connected_clients[client_id]['last_activity'] = time.time()
            
            # Calculate session duration
            session_duration = time.time() - connected_clients[client_id]['connection_time']
            
            # Respond with connection health data
            emit('pong', {
                'server_time': time.time(),
                'session_duration': session_duration,
                'client_id': client_id
            })
    
    except Exception as e:
        logger.error(f"Error handling ping: {str(e)}")
        emit('error', {
            'type': ErrorTypes.NETWORK_ERROR.value,
            'message': 'Error processing ping',
            'details': str(e)
        })


@socketio.on('audio')
def handle_audio(data):
    """Handle audio data from client"""
    client_id = request.sid
    logger.info(f"Received audio data from client: {client_id}")
    
    try:
        # Update last activity timestamp
        if client_id in connected_clients:
            connected_clients[client_id]['last_activity'] = time.time()
        
        # Validate data
        if 'audio_data' not in data:
            logger.error(f"Missing audio_data in request from client {client_id}")
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Missing audio_data in request'
            })
            return
        
        # Get client info
        client_info = connected_clients.get(client_id)
        if not client_info:
            logger.error(f"Client info not found: {client_id}")
            emit('error', {
                'type': ErrorTypes.AUTH_ERROR.value,
                'message': 'Client session not found',
                'reconnect': True
            })
            return
        
        # Check size limits to prevent abuse
        audio_base64 = data['audio_data']
        audio_size = len(audio_base64) * 0.75  # Approximate size of decoded data
        file_format = data.get('file_format', 'webm')
        logger.info(f"Received audio from client {client_id}: size={round(audio_size/1024, 2)}KB, format={file_format}")
        
        if audio_size > 10 * 1024 * 1024:  # 10MB limit per chunk
            logger.error(f"Audio size too large: {round(audio_size/1024/1024, 2)}MB (>10MB)")
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Audio data exceeds size limit'
            })
            return
        
        # Update client stage
        client_info['current_stage'] = PipelineStage.RECEIVING.value
        
        # Store file format with the audio data
        client_info['file_format'] = file_format
        
        # Add audio to buffer
        client_info['audio_buffer'].append(audio_base64)
        
        # Send acknowledgment
        emit('audio_received', {
            'status': 'success',
            'message': 'Audio data received',
            'chunk_size': round(audio_size / 1024, 2),  # Size in KB
            'buffer_size': len(client_info['audio_buffer'])
        })
        
        logger.info(f"Audio received successfully from client {client_id}, now processing automatically")
        
        # Process the audio automatically
        process_audio(client_id)
    
    except Exception as e:
        logger.error(f"Error handling audio: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error processing audio: {str(e)}',
            'retry': True
        })


@socketio.on('audio_chunk_info')
def handle_audio_chunk_info(data):
    """Handle information about incoming chunked audio data"""
    client_id = request.sid
    logger.info(f"Received audio chunk info from client: {client_id}")
    
    try:
        # Update last activity timestamp
        if client_id in connected_clients:
            connected_clients[client_id]['last_activity'] = time.time()
        
        # Get client info
        client_info = connected_clients.get(client_id)
        if not client_info:
            logger.error(f"Client info not found: {client_id}")
            emit('error', {
                'type': ErrorTypes.AUTH_ERROR.value,
                'message': 'Client session not found',
                'reconnect': True
            })
            return
        
        # Validate data
        if not all(k in data for k in ['total_chunks', 'file_format', 'total_size']):
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Missing required chunk info data'
            })
            return
        
        # Initialize or reset chunked audio reception
        client_info['chunked_audio'] = {
            'total_chunks': data['total_chunks'],
            'received_chunks': 0,
            'chunks': [None] * data['total_chunks'],  # Pre-allocate array for chunks
            'file_format': data['file_format'],
            'total_size': data['total_size'],
            'start_time': time.time()
        }
        
        # Clear any existing audio buffer
        client_info['audio_buffer'] = []
        
        # Update client stage
        client_info['current_stage'] = PipelineStage.RECEIVING.value
        
        # Send acknowledgment
        emit('chunk_info_received', {
            'status': 'ready',
            'message': f'Ready to receive {data["total_chunks"]} chunks',
            'chunk_count': data['total_chunks']
        })
        
        logger.info(f"Prepared to receive {data['total_chunks']} audio chunks from {client_id}")
    
    except Exception as e:
        logger.error(f"Error handling audio chunk info: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error processing chunk info: {str(e)}',
            'retry': True
        })


@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    """Handle a single chunk of audio data from the client"""
    client_id = request.sid
    logger.debug(f"Received audio chunk from client: {client_id}")
    
    try:
        # Update last activity timestamp
        if client_id in connected_clients:
            connected_clients[client_id]['last_activity'] = time.time()
        
        # Get client info
        client_info = connected_clients.get(client_id)
        if not client_info:
            logger.error(f"Client info not found: {client_id}")
            emit('error', {
                'type': ErrorTypes.AUTH_ERROR.value,
                'message': 'Client session not found',
                'reconnect': True
            })
            return
        
        # Validate data
        if not all(k in data for k in ['chunk_data', 'chunk_index', 'is_last']):
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Missing required chunk data fields'
            })
            return
        
        # Check if chunked_audio structure is initialized
        if 'chunked_audio' not in client_info:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'No chunk info received before chunk data'
            })
            return
        
        # Get chunk info
        chunk_data = data['chunk_data']
        chunk_index = data['chunk_index']
        is_last = data['is_last']
        
        # Validate chunk index
        if chunk_index < 0 or chunk_index >= client_info['chunked_audio']['total_chunks']:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': f'Invalid chunk index: {chunk_index}'
            })
            return
        
        # Store the chunk
        client_info['chunked_audio']['chunks'][chunk_index] = chunk_data
        client_info['chunked_audio']['received_chunks'] += 1
        
        # Calculate progress
        received = client_info['chunked_audio']['received_chunks']
        total = client_info['chunked_audio']['total_chunks']
        progress = (received / total) * 100
        
        # Send acknowledgment with progress
        emit('chunk_received', {
            'status': 'success',
            'chunk_index': chunk_index,
            'received_chunks': received,
            'total_chunks': total,
            'progress': progress
        })
        
        logger.debug(f"Received chunk {chunk_index+1}/{total} ({progress:.1f}%) from {client_id}")
        
        # If this is the last chunk or all chunks are received, process the complete audio
        if is_last or received == total:
            logger.info(f"All {received} audio chunks received from {client_id}")
            
            # Combine chunks and add to the audio buffer
            complete_audio = ''.join(filter(None, client_info['chunked_audio']['chunks']))
            client_info['audio_buffer'] = [complete_audio]
            client_info['file_format'] = client_info['chunked_audio']['file_format']
            
            # Calculate metrics
            transfer_time = time.time() - client_info['chunked_audio']['start_time']
            total_size = client_info['chunked_audio']['total_size'] 
            transfer_rate = (total_size / 1024) / transfer_time  # KB/s
            
            # Send completion notification
            emit('chunks_complete', {
                'status': 'complete',
                'message': 'All chunks received successfully',
                'stats': {
                    'total_chunks': total,
                    'transfer_time_sec': round(transfer_time, 2),
                    'transfer_rate_kbps': round(transfer_rate, 2),
                    'audio_size_kb': round(total_size / 1024, 2)
                }
            })
            
            logger.info(f"Audio transfer complete: {received} chunks, {round(total_size/1024, 2)}KB in {round(transfer_time, 2)}s at {round(transfer_rate, 2)}KB/s from {client_id}")
            
            # Clean up the chunked_audio data
            del client_info['chunked_audio']
            
            # Automatically process the audio after receiving all chunks
            # instead of waiting for a separate process_audio event
            logger.info(f"Auto-processing received audio for {client_id}")
            process_audio(client_id)
    
    except Exception as e:
        logger.error(f"Error handling audio chunk: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error processing audio chunk: {str(e)}',
            'retry': True
        })


def process_audio(client_id):
    """Process audio data for a specific client"""
    logger.info(f"Processing audio for client: {client_id}")
    
    try:
        # Get client info
        client_info = connected_clients.get(client_id)
        if not client_info:
            logger.error(f"Client info not found: {client_id}")
            return
        
        # Check if we have audio data to process
        if not client_info['audio_buffer']:
            logger.error(f"No audio data to process for client: {client_id}")
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'No audio data to process'
            }, room=client_id)
            return
        
        # Check if already processing
        if client_info['is_processing']:
            logger.warning(f"Client {client_id} is already processing audio")
            emit('error', {
                'type': ErrorTypes.PROCESSING_ERROR.value,
                'message': 'Already processing audio'
            }, room=client_id)
            return
        
        # Mark client as processing
        client_info['is_processing'] = True
        
        # 1. Notify that processing has started
        client_info['current_stage'] = PipelineStage.IDLE.value
        emit('processing_status', {
            'status': 'processing',
            'message': 'Processing audio',
            'stage': 'started',
            'timestamp': time.time()
        }, room=client_id)
        
        # 2. Decode and save audio to temporary file
        audio_data = decode_and_combine_audio(client_info['audio_buffer'])
        
        # Get file format from client info, default to webm
        file_format = client_info.get('file_format', 'webm')
        logger.info(f"Processing audio in format: {file_format}, size: {len(audio_data)} bytes")
        
        # Create appropriate file extension based on format
        if file_format == 'm4a':
            file_extension = '.m4a'
        elif file_format == 'mp3':
            file_extension = '.mp3'
        elif file_format == 'wav':
            file_extension = '.wav'
        else:
            file_extension = '.webm'  # Default format
        
        with tempfile.NamedTemporaryFile(suffix=file_extension, delete=False) as temp_file:
            temp_file_path = temp_file.name
            temp_file.write(audio_data)
            logger.info(f"Saved audio to temporary file: {temp_file_path}")
        
        try:
            # 3. Transcribe audio
            client_info['current_stage'] = PipelineStage.TRANSCRIBING.value
            emit('processing_status', {
                'status': 'processing',
                'message': 'Transcribing audio',
                'stage': 'transcription',
                'timestamp': time.time()
            }, room=client_id)
            
            try:
                # Convert WAV file to MP3 if needed (some WAV formats aren't supported by Whisper)
                if file_format == 'wav':
                    logger.info(f"Received WAV file, making sure it's in a supported format")
                    try:
                        import subprocess
                        
                        # Convert WAV to MP3 using ffmpeg
                        mp3_file_path = temp_file_path.replace('.wav', '.mp3')
                        subprocess.run(['ffmpeg', '-i', temp_file_path, '-acodec', 'libmp3lame', '-y', mp3_file_path], 
                                      check=True, capture_output=True)
                        
                        logger.info(f"Successfully converted WAV to MP3: {mp3_file_path}")
                        # Use the converted file
                        if os.path.exists(mp3_file_path) and os.path.getsize(mp3_file_path) > 0:
                            temp_file_path = mp3_file_path
                            file_format = 'mp3'
                        else:
                            logger.warning(f"Conversion failed or output file is empty, trying with original WAV")
                    except Exception as convert_error:
                        logger.warning(f"Failed to convert WAV to MP3: {str(convert_error)}")
                        # Continue with the original file
                
                # Send the file for transcription
                logger.info(f"Sending file for transcription: {temp_file_path} (format: {file_format})")
                transcription = transcribe_audio_file(temp_file_path)
                logger.info(f"Transcription: {transcription}")
                
                # Send transcription to client
                emit('transcription', {
                    'text': transcription,
                    'timestamp': time.time()
                }, room=client_id)
                
                # Set client back to idle after transcription
                client_info['current_stage'] = PipelineStage.IDLE.value
                client_info['is_processing'] = False
                
            except Exception as transcription_error:
                logger.error(f"Transcription error: {str(transcription_error)}")
                emit('error', {
                    'type': ErrorTypes.API_ERROR.value,
                    'message': 'Failed to transcribe audio',
                    'details': str(transcription_error),
                    'stage': 'transcription'
                }, room=client_id)
                raise
                
        finally:
            # Clean up temporary files
            for file_path in [temp_file_path, temp_file_path.replace('.wav', '.mp3')]:
                if os.path.exists(file_path):
                    try:
                        os.unlink(file_path)
                    except Exception as e:
                        logger.warning(f"Failed to delete temporary file {file_path}: {str(e)}")
            
            # Reset the audio buffer
            client_info['audio_buffer'] = []
            client_info['is_processing'] = False
    
    except Exception as e:
        logger.error(f"Error processing audio: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error processing audio: {str(e)}',
            'recoverable': True
        }, room=client_id)
        
        # Reset processing state and update stage
        if client_id in connected_clients:
            connected_clients[client_id]['is_processing'] = False
            connected_clients[client_id]['current_stage'] = PipelineStage.IDLE.value


def decode_and_combine_audio(audio_buffer):
    """Decode base64 audio chunks and combine them"""
    combined_audio = bytearray()
    
    for audio_base64 in audio_buffer:
        chunk_data = base64.b64decode(audio_base64)
        combined_audio.extend(chunk_data)
    
    return combined_audio


@socketio.on('text_message')
def handle_text_message(data):
    """Handle text message from client (for testing without audio)"""
    client_id = request.sid
    logger.info(f"Received text message from client: {client_id}")
    
    try:
        # Update last activity timestamp
        if client_id in connected_clients:
            connected_clients[client_id]['last_activity'] = time.time()
        
        # Validate data
        if 'text' not in data:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Missing text in request'
            })
            return
        
        text = data['text']
        logger.info(f"Text message: {text}")
        
        # Get client info
        client_info = connected_clients.get(client_id)
        if not client_info:
            logger.error(f"Client info not found: {client_id}")
            emit('error', {
                'type': ErrorTypes.AUTH_ERROR.value,
                'message': 'Client session not found',
                'reconnect': True
            })
            return
        
        # Check if already processing
        if client_info['is_processing']:
            emit('error', {
                'type': ErrorTypes.PROCESSING_ERROR.value,
                'message': 'Already processing request'
            })
            return
        
        # Mark client as processing
        client_info['is_processing'] = True
        
        try:
            # 1. Add user message to conversation history
            client_info['conversation_history'].append({
                "role": "user",
                "content": text
            })
            
            # 2. Process with LLM
            client_info['current_stage'] = PipelineStage.PROCESSING.value
            emit('processing_status', {
                'status': 'processing',
                'message': 'Generating response',
                'stage': 'llm',
                'timestamp': time.time()
            })
            
            try:
                # Generate response
                response_text = generate_chat_response(client_info['conversation_history'])
                logger.info(f"Response: {response_text}")
                
                # Add assistant response to conversation history
                client_info['conversation_history'].append({
                    "role": "assistant",
                    "content": response_text
                })
            except Exception as llm_error:
                logger.error(f"LLM processing error: {str(llm_error)}")
                emit('error', {
                    'type': ErrorTypes.API_ERROR.value,
                    'message': 'Failed to generate response',
                    'details': str(llm_error),
                    'stage': 'llm'
                })
                raise
            
            # 3. Convert to speech
            client_info['current_stage'] = PipelineStage.GENERATING_SPEECH.value
            emit('processing_status', {
                'status': 'processing',
                'message': 'Converting to speech',
                'stage': 'tts',
                'timestamp': time.time()
            })
            
            try:
                audio_base64 = generate_speech(response_text)
            except Exception as tts_error:
                logger.error(f"TTS error: {str(tts_error)}")
                emit('error', {
                    'type': ErrorTypes.API_ERROR.value,
                    'message': 'Failed to convert text to speech',
                    'details': str(tts_error),
                    'stage': 'tts',
                    'text_response': response_text  # Still send text response even if TTS fails
                })
                # Don't raise here, we can still send the text response
                audio_base64 = None
            
            # 4. Send response to client
            client_info['current_stage'] = PipelineStage.SENDING.value
            emit('response', {
                'text': response_text,
                'audio': audio_base64,
                'type': 'voice' if audio_base64 else 'text',
                'timestamp': time.time()
            })
            
            # Set stage back to idle
            client_info['current_stage'] = PipelineStage.IDLE.value
            
            # Keep only last 10 messages in conversation history to prevent context overflow
            if len(client_info['conversation_history']) > 12:  # system + 5 turns (10 messages)
                client_info['conversation_history'] = client_info['conversation_history'][:1] + client_info['conversation_history'][-10:]
                
            # Send final status update
            emit('processing_status', {
                'status': 'completed',
                'message': 'Processing completed successfully',
                'stage': 'completed',
                'timestamp': time.time()
            })
        finally:
            # Reset processing state
            client_info['is_processing'] = False
    
    except Exception as e:
        logger.error(f"Error handling text message: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error handling text message: {str(e)}',
            'recoverable': True
        })
        
        # Reset processing state
        if client_id in connected_clients:
            connected_clients[client_id]['is_processing'] = False
            connected_clients[client_id]['current_stage'] = PipelineStage.IDLE.value


@socketio.on('error')
def handle_error(error_data):
    """Handle error messages from client"""
    client_id = request.sid
    logger.error(f"Error from client {client_id}: {error_data}")
    
    try:
        error_type = error_data.get('type', 'unknown')
        error_message = error_data.get('message', 'No message provided')
        error_details = error_data.get('details', {})
        
        # Log detailed error information
        logger.error(f"Client error - Type: {error_type}, Message: {error_message}, Details: {error_details}")
        
        # Update client state if needed
        if client_id in connected_clients:
            # Reset processing flag if client reports error during processing
            if error_type == 'processing_error' and connected_clients[client_id]['is_processing']:
                connected_clients[client_id]['is_processing'] = False
            
            # Update last activity
            connected_clients[client_id]['last_activity'] = time.time()
    
    except Exception as e:
        logger.error(f"Error handling client error message: {str(e)}")
        logger.error(traceback.format_exc())


# Health check event
@socketio.on('health_check')
def handle_health_check():
    """Handle health check requests"""
    client_id = request.sid
    
    try:
        # Verify client exists
        if client_id not in connected_clients:
            emit('health_response', {
                'status': 'error',
                'message': 'Client session not found'
            })
            return
        
        # Update last activity
        connected_clients[client_id]['last_activity'] = time.time()
        
        # Basic service status
        openai_available = True
        try:
            # Simple check that client is initialized
            client.models.list(limit=1)
        except Exception:
            openai_available = False
        
        # Send health status
        emit('health_response', {
            'status': 'ok',
            'timestamp': time.time(),
            'services': {
                'openai_api': openai_available,
                'websocket': True,
                'audio_processing': True
            },
            'client_info': {
                'session_duration': time.time() - connected_clients[client_id]['connection_time'],
                'conversation_turns': len(connected_clients[client_id]['conversation_history']) - 1 if connected_clients[client_id]['conversation_history'] else 0
            }
        })
    
    except Exception as e:
        logger.error(f"Error handling health check: {str(e)}")
        logger.error(traceback.format_exc())
        emit('health_response', {
            'status': 'error',
            'message': str(e)
        })


# Add WebRTC signaling events
@socketio.on('webrtc_offer')
def handle_webrtc_offer(data):
    """Handle WebRTC offer from client and forward to the target client"""
    client_id = request.sid
    logger.info(f"WebRTC offer from client: {client_id}")
    
    try:
        # Update last activity timestamp
        if client_id in connected_clients:
            connected_clients[client_id]['last_activity'] = time.time()
        
        # Validate data
        if 'target' not in data or 'sdp' not in data:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Missing target or SDP in offer request'
            })
            return
        
        target_client_id = data['target']
        sdp_offer = data['sdp']
        
        # If target is 'server', handle it directly
        if target_client_id == 'server':
            # Mark client as using WebRTC
            if client_id in connected_clients:
                connected_clients[client_id]['using_webrtc'] = True
            
            # For demo/testing purposes, just acknowledge the offer
            # In a real implementation, we would create a proper SDP answer here
            emit('webrtc_stream_ready_ack', {
                'status': 'success',
                'message': 'WebRTC offer acknowledged'
            })
            logger.info(f"WebRTC offer received from {client_id} and acknowledged by server")
            return
        
        # Check if target client exists
        if target_client_id not in connected_clients:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Target client not found or not connected'
            })
            return
        
        # Forward offer to target client
        emit('webrtc_offer', {
            'from': client_id,
            'sdp': sdp_offer
        }, room=target_client_id)
        
        logger.info(f"WebRTC offer forwarded from {client_id} to {target_client_id}")
    
    except Exception as e:
        logger.error(f"Error handling WebRTC offer: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error handling WebRTC offer: {str(e)}'
        })


@socketio.on('webrtc_answer')
def handle_webrtc_answer(data):
    """Handle WebRTC answer from client and forward to the target client"""
    client_id = request.sid
    logger.info(f"WebRTC answer from client: {client_id}")
    
    try:
        # Update last activity timestamp
        if client_id in connected_clients:
            connected_clients[client_id]['last_activity'] = time.time()
        
        # Validate data
        if 'target' not in data or 'sdp' not in data:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Missing target or SDP in answer request'
            })
            return
        
        target_client_id = data['target']
        sdp_answer = data['sdp']
        
        # Check if target client exists
        if target_client_id not in connected_clients:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Target client not found or not connected'
            })
            return
        
        # Forward answer to target client
        emit('webrtc_answer', {
            'from': client_id,
            'sdp': sdp_answer
        }, room=target_client_id)
        
        logger.info(f"WebRTC answer forwarded from {client_id} to {target_client_id}")
    
    except Exception as e:
        logger.error(f"Error handling WebRTC answer: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error handling WebRTC answer: {str(e)}'
        })


@socketio.on('webrtc_ice_candidate')
def handle_ice_candidate(data):
    """Handle ICE candidate from client and forward to the target client"""
    client_id = request.sid
    logger.debug(f"ICE candidate from client: {client_id}")
    
    try:
        # Update last activity timestamp
        if client_id in connected_clients:
            connected_clients[client_id]['last_activity'] = time.time()
        
        # Validate data
        if 'target' not in data or 'candidate' not in data:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Missing target or candidate in ICE request'
            })
            return
        
        target_client_id = data['target']
        ice_candidate = data['candidate']
        
        # If target is 'server', just acknowledge it
        if target_client_id == 'server':
            # Just acknowledge the ICE candidate without forwarding
            logger.debug(f"ICE candidate received from {client_id} for server (acknowledged)")
            return
        
        # Check if target client exists
        if target_client_id not in connected_clients:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Target client not found or not connected'
            })
            return
        
        # Forward ICE candidate to target client
        emit('webrtc_ice_candidate', {
            'from': client_id,
            'candidate': ice_candidate
        }, room=target_client_id)
        
        logger.debug(f"ICE candidate forwarded from {client_id} to {target_client_id}")
    
    except Exception as e:
        logger.error(f"Error handling ICE candidate: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error handling ICE candidate: {str(e)}'
        })


@socketio.on('webrtc_stream_ready')
def handle_stream_ready(data):
    """Handle client notification that stream is ready for processing"""
    client_id = request.sid
    logger.info(f"WebRTC stream ready from client: {client_id}")
    
    try:
        # Update last activity timestamp
        if client_id in connected_clients:
            connected_clients[client_id]['last_activity'] = time.time()
            connected_clients[client_id]['using_webrtc'] = True
        
        # Acknowledge stream ready
        emit('webrtc_stream_ready_ack', {
            'status': 'success',
            'message': 'WebRTC stream ready acknowledged'
        })
        
    except Exception as e:
        logger.error(f"Error handling WebRTC stream ready: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error handling WebRTC stream ready: {str(e)}'
        })


@socketio.on('webrtc_stream_chunk')
def handle_stream_chunk(data):
    """Handle audio chunk from WebRTC stream for real-time processing"""
    client_id = request.sid
    logger.debug(f"WebRTC stream chunk from client: {client_id}")
    
    try:
        # Get client info
        client_info = connected_clients.get(client_id)
        if not client_info:
            logger.error(f"Client info not found: {client_id}")
            emit('error', {
                'type': ErrorTypes.AUTH_ERROR.value,
                'message': 'Client session not found',
                'reconnect': True
            })
            return
        
        # Validate data
        if 'audio_data' not in data:
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Missing audio_data in WebRTC chunk'
            })
            return
            
        # Process the audio chunk
        # This will need to be implemented as part of the VAD system in BD4
        # For now, we'll just acknowledge receipt
        emit('webrtc_chunk_received', {
            'status': 'success',
            'timestamp': time.time()
        })
        
    except Exception as e:
        logger.error(f"Error handling WebRTC stream chunk: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error handling WebRTC stream chunk: {str(e)}'
        })


@socketio.on('process_audio')
def handle_process_audio(data=None):
    """Handle manual request to process audio"""
    client_id = request.sid
    logger.info(f"Manual processing audio request from client: {client_id}")
    
    # Update last activity timestamp
    if client_id in connected_clients:
        connected_clients[client_id]['last_activity'] = time.time()
    
    # Call the process_audio function with the client ID
    process_audio(client_id)


@socketio.on('process_transcription')
def handle_process_transcription(data):
    """Handle request to process transcription text with LLM"""
    client_id = request.sid
    logger.info(f"Processing transcription request from client: {client_id}")
    
    try:
        # Get client info
        client_info = connected_clients.get(client_id)
        if not client_info:
            logger.error(f"Client info not found: {client_id}")
            emit('error', {
                'type': ErrorTypes.AUTH_ERROR.value,
                'message': 'Client session not found',
                'reconnect': True
            }, room=client_id)
            return
        
        # Check if already processing
        if client_info.get('is_processing'):
            logger.warning(f"Client {client_id} is already processing a request")
            emit('error', {
                'type': ErrorTypes.PROCESSING_ERROR.value,
                'message': 'Already processing a request'
            }, room=client_id)
            return
        
        # Validate data
        if not data or 'text' not in data:
            logger.error(f"Missing transcription text in request from {client_id}")
            emit('error', {
                'type': ErrorTypes.VALIDATION_ERROR.value,
                'message': 'Missing transcription text in request'
            }, room=client_id)
            return
        
        transcription_text = data['text']
        voice_preference = data.get('voice', 'alloy')  # Default to 'alloy' voice
        should_generate_speech = data.get('generate_speech', True)  # Default to generating speech
        
        logger.info(f"Processing transcription: '{transcription_text}' from client: {client_id}")
        
        # Mark client as processing
        client_info['is_processing'] = True
        client_info['current_stage'] = PipelineStage.PROCESSING.value
        
        # Notify client that processing has started
        emit('processing_status', {
            'status': 'processing',
            'message': 'Processing transcription',
            'stage': 'llm',
            'timestamp': time.time()
        }, room=client_id)
        
        try:
            # 1. Add user message to conversation history
            client_info['conversation_history'].append({
                "role": "user",
                "content": transcription_text
            })
            
            # 2. Process with LLM
            logger.info(f"Sending to LLM for processing")
            response_text = generate_chat_response(client_info['conversation_history'])
            logger.info(f"LLM Response: {response_text}")
            
            # 3. Add assistant response to conversation history
            client_info['conversation_history'].append({
                "role": "assistant",
                "content": response_text
            })
            
            # Initialize audio_data as None
            audio_data = None
            
            # 4. Generate speech if requested
            if should_generate_speech:
                try:
                    client_info['current_stage'] = PipelineStage.GENERATING_SPEECH.value
                    emit('processing_status', {
                        'status': 'processing',
                        'message': 'Generating speech',
                        'stage': 'tts',
                        'timestamp': time.time()
                    }, room=client_id)
                    
                    logger.info(f"Generating speech for response using voice: {voice_preference}")
                    audio_data = generate_speech(response_text, voice=voice_preference)
                    logger.info(f"Speech generated successfully, size: {len(audio_data) if audio_data else 0} bytes")
                    
                except Exception as speech_error:
                    logger.error(f"Error generating speech: {str(speech_error)}")
                    logger.error(traceback.format_exc())
                    # Continue with text-only response
                    emit('error', {
                        'type': ErrorTypes.API_ERROR.value,
                        'message': 'Failed to generate speech audio',
                        'details': str(speech_error),
                        'stage': 'tts'
                    }, room=client_id)
            
            # 5. Send response back to client
            client_info['current_stage'] = PipelineStage.SENDING.value
            emit('response', {
                'text': response_text,
                'audio': audio_data,
                'type': 'voice' if audio_data else 'text',
                'timestamp': time.time(),
                'is_final': True
            }, room=client_id)
            
            logger.info(f"Response sent to client {client_id} with audio: {audio_data is not None}")
            
        except Exception as processing_error:
            logger.error(f"Error processing transcription: {str(processing_error)}")
            logger.error(traceback.format_exc())
            emit('error', {
                'type': ErrorTypes.API_ERROR.value,
                'message': 'Failed to process transcription',
                'details': str(processing_error),
                'stage': 'llm'
            }, room=client_id)
        
        finally:
            # Reset processing state
            client_info['is_processing'] = False
            client_info['current_stage'] = PipelineStage.IDLE.value
    
    except Exception as e:
        logger.error(f"Error handling process_transcription: {str(e)}")
        logger.error(traceback.format_exc())
        emit('error', {
            'type': ErrorTypes.PROCESSING_ERROR.value,
            'message': f'Error handling process_transcription: {str(e)}',
            'recoverable': True
        }, room=client_id)
        
        # Reset processing state if client still exists
        if client_id in connected_clients:
            connected_clients[client_id]['is_processing'] = False
            connected_clients[client_id]['current_stage'] = PipelineStage.IDLE.value 