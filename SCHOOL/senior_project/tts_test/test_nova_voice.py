import openai
import os
from pathlib import Path

def get_text_input():
    print("\nHow would you like to input text?")
    print("1. Type text directly")
    print("2. Read from file")
    choice = input("Enter choice (1 or 2): ").strip()
    
    if choice == "1":
        print("\nEnter the text you want to convert to speech:")
        text = input("> ").strip()
        if not text:
            raise ValueError("Text cannot be empty")
        return text
    elif choice == "2":
        print("\nEnter the path to your text file (relative to current directory):")
        file_path = input("> ").strip()
        try:
            with open(file_path, 'r') as file:
                # Remove SSML tags if present since OpenAI doesn't support them
                text = file.read().strip()
                text = text.replace('<speak>', '').replace('</speak>', '')
                text = text.replace('<break time="1s"/>', '').replace('<break time="1.5s"/>', '')
                text = text.replace('<break time="2s"/>', '').replace('<break time="3s"/>', '')
                text = text.replace('<break time="4s"/>', '')
                text = text.replace('<prosody rate="slow">', '').replace('</prosody>', '')
                text = text.replace('<prosody rate="medium">', '').replace('</prosody>', '')
                if not text:
                    raise ValueError("File is empty")
                return text
        except FileNotFoundError:
            raise ValueError(f"File not found: {file_path}")
    else:
        raise ValueError("Invalid choice. Please enter 1 or 2.")

def generate_speech_nova(text):
    try:
        # Create output directory if it doesn't exist
        output_dir = Path(os.path.dirname(__file__))
        
        # Generate speech using Nova voice
        response = openai.audio.speech.create(
            model="tts-1",  # or "tts-1-hd" for higher quality
            voice="nova",
            input=text
        )
        
        # Save the audio file
        output_file = output_dir / "tts_output_nova.mp3"
        response.stream_to_file(str(output_file))
        print(f'\nAudio content written to "{output_file}"')
        
    except Exception as e:
        print(f"Error generating speech: {str(e)}")
        raise

def main():
    # Check for OpenAI API key
    if "OPENAI_API_KEY" not in os.environ:
        api_key = input("Please enter your OpenAI API key: ").strip()
        os.environ["OPENAI_API_KEY"] = api_key
    
    print("\nOpenAI TTS Test - Nova Voice")
    print("Note: Nova doesn't support SSML, but can handle natural pauses and intonation.")
    
    while True:
        try:
            # Get the text to synthesize
            text = get_text_input()
            
            # Generate speech with Nova voice
            print("\nGenerating speech using Nova voice...")
            generate_speech_nova(text)
            
            # Ask if user wants to try another text
            print("\nWould you like to try another text? (y/n)")
            if input("> ").strip().lower() != 'y':
                break
                
        except ValueError as e:
            print(f"\nError: {str(e)}")
        except Exception as e:
            print(f"\nAn error occurred: {str(e)}")
            break

if __name__ == "__main__":
    main() 