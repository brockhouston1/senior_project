# Panic Button - Voice-Powered Mental Health Assistant

A mobile application designed to provide immediate support for anxiety and panic attacks through natural voice conversation. Built with React Native and Flask, featuring real-time voice processing and AI-powered responses.

## Features

- **Natural Voice Interaction**
  - Hands-free conversation with adaptive silence detection
  - Real-time voice processing and transcription
  - Text-to-speech responses with natural intonation

- **AI-Powered Support**
  - Contextual conversations with memory of past interactions
  - Calming, supportive responses tailored for anxiety support
  - Privacy-focused design with all data stored locally

- **Session Management**
  - Review past conversations and coping strategies
  - Track progress over time
  - Private, local storage of all session data

## Architecture

- **Mobile Client** (`/mobile`)
  - React Native application with TypeScript
  - Voice state management and audio processing
  - Local session storage and management
  - Real-time WebSocket communication

- **Backend Server** (`/backend`)
  - Flask API server with Socket.IO
  - OpenAI integration for conversation and speech processing
  - Real-time audio streaming support
  - Session management and data processing

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- Python 3.8+
- iOS Simulator or Android Emulator
- OpenAI API key

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/brockhouston1/senior_project.git
   cd senior_project
   ```

2. **Set up the backend**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Set up the mobile app**
   ```bash
   cd ../mobile
   npm install
   ```

4. **Configure environment variables**
   - Create `.env` file in the backend directory with your OpenAI API key
   - Configure mobile app settings in `app.json`

5. **Run the application**
   - Start the backend server:
     ```bash
     cd backend
     python app.py
     ```
   - Start the mobile app:
     ```bash
     cd mobile
     npm start
     ```

## Technical Details

- **Voice Processing**
  - Adaptive silence detection for natural conversation flow
  - Real-time audio level monitoring
  - WebRTC for efficient audio streaming

- **AI Integration**
  - OpenAI's GPT-4 for contextual responses
  - Whisper for speech-to-text
  - Custom system prompts for supportive dialogue

- **Data Management**
  - AsyncStorage for local session persistence
  - Efficient metadata indexing for quick access
  - Privacy-first design with no cloud storage

## Future Work

- Conversation pattern analysis for personalized support
- Wearable device integration for biometric data
- Expanded wellness modules and coping strategies
- Multi-language support
- Offline mode with local AI processing

## Contributing

This project is currently in active development. Feel free to submit issues or pull requests for improvements.

## License

