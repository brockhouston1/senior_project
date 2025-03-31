# This file makes the voice_assistant directory a Python package 

# Import and export the socketio instance
from flask_socketio import SocketIO

# Create Socket.IO instance to be used across the app
socketio = SocketIO() 