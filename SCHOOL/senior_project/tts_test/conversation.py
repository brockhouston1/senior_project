import openai
import os
from pathlib import Path
import speech_recognition as sr
import pygame
import time
import re
import io
import threading
import queue
import tempfile

class Conversation:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.messages = [
            {"role": "system", "content": "You are a helpful assistant. Keep your responses concise and conversational. Use natural breaks and pauses in your speech."}
        ]
        pygame.mixer.init()
        self.output_dir = Path(os.path.dirname(__file__))
        
    def listen(self):
        """Listen for user input through microphone"""
        with sr.Microphone() as source:
            print("\nListening... (speak now)")
            self.recognizer.adjust_for_ambient_noise(source)
            try:
                audio = self.recognizer.listen(source, timeout=5)
                print("Processing speech...")
                text = self.recognizer.recognize_google(audio)
                print(f"You said: {text}")
                return text
            except sr.WaitTimeoutError:
                print("No speech detected")
                return None
            except sr.UnknownValueError:
                print("Could not understand audio")
                return None
            except sr.RequestError as e:
                print(f"Could not request results; {e}")
                return None

    def get_ai_response(self, user_input):
        """Get response from OpenAI"""
        self.messages.append({"role": "user", "content": user_input})
        
        try:
            response = openai.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=self.messages,
                stream=True  # Enable streaming for faster first token
            )
            
            # Collect the streamed response
            collected_chunks = []
            collected_messages = []
            
            # Process the streamed response
            for chunk in response:
                collected_chunks.append(chunk)
                chunk_message = chunk.choices[0].delta
                collected_messages.append(chunk_message.content if hasattr(chunk_message, 'content') else "")
            
            # Combine the message
            ai_response = ''.join([m for m in collected_messages if m is not None])
            self.messages.append({"role": "assistant", "content": ai_response})
            return ai_response
            
        except Exception as e:
            print(f"Error getting AI response: {e}")
            return None

    def chunk_text(self, text):
        """Split text into natural chunks for speech"""
        # First split by sentence endings
        chunks = re.split('([.!?]+)', text)
        
        # Recombine sentence endings with their sentences
        proper_sentences = []
        for i in range(0, len(chunks)-1, 2):
            if i+1 < len(chunks):
                proper_sentences.append(chunks[i] + chunks[i+1])
            else:
                proper_sentences.append(chunks[i])
        
        # Handle any remaining text
        if chunks[-1]:
            proper_sentences.append(chunks[-1])
        
        # Further split long sentences by commas if they're too long
        final_chunks = []
        for sentence in proper_sentences:
            if len(sentence) > 100:  # If sentence is very long
                comma_chunks = sentence.split(',')
                for chunk in comma_chunks:
                    if chunk.strip():
                        final_chunks.append(chunk.strip())
            else:
                if sentence.strip():
                    final_chunks.append(sentence.strip())
        
        return final_chunks

    def play_audio(self, audio_file):
        """Play audio using pygame"""
        try:
            pygame.mixer.music.load(audio_file)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                pygame.time.Clock().tick(10)
        except Exception as e:
            print(f"Error playing audio: {e}")

    def speak_chunk(self, text, chunk_number):
        """Convert text chunk to speech using Nova voice and stream the audio"""
        try:
            # Generate speech with streaming
            response = openai.audio.speech.create(
                model="tts-1",  # Using standard model for lower latency
                voice="nova",
                input=text,
                speed=1.1  # Slightly faster speech for more natural conversation
            )

            # Create a temporary file to store the audio chunk
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
                # Stream the audio data to the temporary file
                for chunk in response.iter_bytes(chunk_size=4096):
                    temp_file.write(chunk)
                temp_file.flush()
                
                # Play the audio
                self.play_audio(temp_file.name)

            # Clean up the temporary file
            os.unlink(temp_file.name)
                
        except Exception as e:
            print(f"Error generating or playing speech chunk: {e}")

    def speak(self, text):
        """Split response into chunks and speak them sequentially with streaming"""
        chunks = self.chunk_text(text)
        print("\nAI: ", end='', flush=True)
        
        for i, chunk in enumerate(chunks):
            # Print chunk with appropriate punctuation
            print(chunk, end=' ', flush=True)
            self.speak_chunk(chunk, i)
            
        print()  # New line after complete response

def main():
    # Check for OpenAI API key
    if "OPENAI_API_KEY" not in os.environ:
        api_key = input("Please enter your OpenAI API key: ").strip()
        os.environ["OPENAI_API_KEY"] = api_key
    
    print("\nVoice Conversation with AI (using Nova voice)")
    print("Speak to interact with the AI, or say 'quit' to exit")
    
    conversation = Conversation()
    
    while True:
        # Get user input through speech
        user_input = conversation.listen()
        
        if user_input:
            if user_input.lower() in ['quit', 'exit', 'bye']:
                print("Goodbye!")
                conversation.speak("Goodbye!")
                break
            
            # Get AI response
            ai_response = conversation.get_ai_response(user_input)
            if ai_response:
                # Speak response in chunks
                conversation.speak(ai_response)
        
        print("\nReady for next input...")

if __name__ == "__main__":
    main() 