import boto3
import os
import time
import pygame
import speech_recognition as sr
from io import BytesIO
from contextlib import closing
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

# Available voice options
AVAILABLE_VOICES = {
    "1": "Matthew",
    "2": "Joanna",
    "3": "Stephen",
    "4": "Ruth",
    "5": "Kevin",
    "6": "Danielle"
}

def listen_for_speech():
    """
    Listen to the microphone and convert speech to text
    """
    recognizer = sr.Recognizer()
    
    print("Listening... (speak now)")
    
    try:
        with sr.Microphone() as source:
            # Adjust for ambient noise and set timeout
            recognizer.adjust_for_ambient_noise(source, duration=1)
            audio = recognizer.listen(source, timeout=10, phrase_time_limit=15)
        
        print("Processing speech...")
        
        # Use Google's speech recognition
        text = recognizer.recognize_google(audio)
        print(f"You said: {text}")
        return text
    
    except sr.WaitTimeoutError:
        print("No speech detected within timeout period")
        return None
    except sr.UnknownValueError:
        print("Sorry, I couldn't understand what you said")
        return None
    except sr.RequestError as e:
        print(f"Could not request results from speech recognition service; {e}")
        return None
    except Exception as e:
        print(f"Error during speech recognition: {e}")
        return None

def generate_text_with_openai(prompt):
    api_key = os.environ.get("OPENAI_API_KEY")
    
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable not set")
    
    client = OpenAI(api_key=api_key)
    
    try:
        start_time = time.time()
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",  # Changed from gpt-3.5-turbo to gpt-4o-mini
            messages=[
                {"role": "system", "content": """You are a helpful assistant. Keep your responses brief and concise, ideally 2-3 sentences maximum.
                You speak gentle-like and are very kind and understanding. You want to make the user calm and feel understood."""},
                {"role": "user", "content": prompt}
            ],
            temperature=1.0,
            max_tokens=150,  # Reduced from 300 to 150 for shorter responses
            stream=True
        )
        
        collected_response = ""
        print("\nResponse streaming:")
        for chunk in response:
            chunk_content = chunk.choices[0].delta.content
            if chunk_content is not None:
                print(chunk_content, end="", flush=True)
                collected_response += chunk_content
        print("\n")
        
        elapsed = time.time() - start_time
        return collected_response, elapsed
    
    except Exception as e:
        print(f"Error: {str(e)}")
        return None, 0

def text_to_speech_streaming(text, output_file="speech.mp3", voice_id="Matthew"):
    # Get credentials from environment variables
    access_key = os.environ.get("AWS_ACCESS_KEY_ID")
    secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
    region = os.environ.get("AWS_REGION", "us-east-1")
    
    if not access_key or not secret_key:
        print("Error: AWS credentials not found in environment variables")
        print("Make sure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set in your .env file")
        return False
    
    # Create client with explicit credentials
    polly_client = boto3.client(
        'polly',
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region
    )
    
    try:
        print(f"\nGenerating speech with {voice_id} voice...")
        
        # Request speech synthesis
        response = polly_client.synthesize_speech(
            Engine="generative",
            LanguageCode="en-US",
            OutputFormat="mp3",
            VoiceId=voice_id,
            Text=text
        )
        
        # Initialize pygame mixer
        pygame.mixer.init()
        
        # Save the audio stream to a file and play it
        if "AudioStream" in response:
            # Save to a BytesIO object first
            audio_stream = BytesIO()
            audio_stream.write(response["AudioStream"].read())
            audio_stream.seek(0)
            
            # Save to file
            with open(output_file, "wb") as file:
                file.write(audio_stream.getvalue())
            
            print(f"Audio saved to {output_file}")
            print("Playing audio...")
            
            # Load and play the audio
            pygame.mixer.music.load(output_file)
            pygame.mixer.music.play()
            
            # Wait for playback to finish
            while pygame.mixer.music.get_busy():
                pygame.time.Clock().tick(10)
            
            return True
    
    except Exception as e:
        print(f"Error: {str(e)}")
        return False

def select_voice():
    """
    Allows the user to select a voice
    """
    print("\nAvailable voices:")
    for key, name in AVAILABLE_VOICES.items():
        gender = "female" if name in ["Joanna", "Ruth", "Danielle"] else "male"
        print(f"{key}. {name} (generative, {gender})")
    
    while True:
        choice = input("\nSelect voice (1-6, default is 1): ")
        if choice == "":
            return "Matthew"  # Default
        elif choice in AVAILABLE_VOICES:
            return AVAILABLE_VOICES[choice]
        else:
            print("Invalid choice. Please select 1-6.")

def check_for_voice_command(text, current_voice):
    """
    Check if the text contains a command to change voice
    Returns the new voice if command found, or None if no command
    """
    text_lower = text.lower()
    
    # Check for various voice change phrases
    if "change voice" in text_lower or "switch voice" in text_lower or "use voice" in text_lower:
        for key, name in AVAILABLE_VOICES.items():
            if name.lower() in text_lower:
                print(f"Changing voice to {name}")
                return name
        
        # If voice name not found in command but change requested
        if "change voice" in text_lower or "switch voice" in text_lower:
            print("Voice change requested. Please select:")
            return select_voice()
    
    return None  # No voice change command found

# Main function
def main():
    print("Welcome to the voice assistant!")
    print("You can:")
    print("- Speak directly to ask questions")
    print("- Say 'change voice' to select a different voice")
    print("- Type 'text' to switch to text input mode")
    print("- Say or type 'exit' to quit")
    
    voice_mode = True  # Start in voice mode by default
    
    # Initial voice selection
    print("\nFirst, let's choose a voice for the assistant.")
    current_voice = select_voice()
    print(f"Using {current_voice}'s voice. Let's begin!")
    
    while True:
        if voice_mode:
            print("\nListening mode active (say something or type 'text' to switch modes)...")
            # Give a brief moment for user to decide to type instead
            for i in range(3):
                user_choice = input("Press Enter to start listening or type 'text' or 'exit': ")
                if user_choice.lower() == 'text':
                    voice_mode = False
                    print("Switched to text input mode.")
                    break
                elif user_choice.lower() == 'exit':
                    print("Exiting program. Goodbye!")
                    return
                elif user_choice.lower() == 'voice':
                    current_voice = select_voice()
                    print(f"Changed voice to {current_voice}")
                    break
                elif user_choice != "":
                    # If they typed something else, treat it as a text prompt
                    user_prompt = user_choice
                    voice_mode = False
                    break
            
            # If still in voice mode, listen for speech
            if voice_mode:
                user_prompt = listen_for_speech()
                if not user_prompt:
                    print("I didn't catch that. Let's try again.")
                    continue
                
                if user_prompt.lower() == 'exit':
                    print("Exiting program. Goodbye!")
                    break
                elif user_prompt.lower() == 'text':
                    voice_mode = False
                    print("Switched to text input mode.")
                    continue
                
                # Check if this is a voice change command
                new_voice = check_for_voice_command(user_prompt, current_voice)
                if new_voice:
                    current_voice = new_voice
                    print(f"Voice changed to {current_voice}")
                    continue
        else:
            # Text input mode
            user_prompt = input("\nType your prompt (or 'voice' to switch to voice mode, 'voice select' to change voice, 'exit' to quit): ")
            
            if user_prompt.lower() == 'exit':
                print("Exiting program. Goodbye!")
                break
            elif user_prompt.lower() == 'voice':
                voice_mode = True
                print("Switched to voice input mode.")
                continue
            elif user_prompt.lower() == 'voice select':
                current_voice = select_voice()
                print(f"Changed voice to {current_voice}")
                continue
        
        # Process the prompt and get response
        ai_response, elapsed_time = generate_text_with_openai(user_prompt)
        
        if ai_response:
            print(f"\nResponse (took {elapsed_time:.2f} seconds):")
            
            # Use the selected voice
            filename = f"{current_voice.lower()}_response.mp3"
            text_to_speech_streaming(ai_response, filename, current_voice)
        else:
            print("Failed to get a response")

if __name__ == "__main__":
    main() 