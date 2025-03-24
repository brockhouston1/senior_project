from google.cloud import texttospeech
import os

# Set the credentials environment variable
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(os.path.dirname(__file__), "credentials.json")

def get_english_premium_voices():
    client = texttospeech.TextToSpeechClient()
    response = client.list_voices()
    
    def is_gb_us_voice(voice):
        return any(lang in ['en-GB', 'en-US'] for lang in voice.language_codes)
    
    # Get all GB and US premium voices
    journey_voices = [voice for voice in response.voices if "Journey" in voice.name and is_gb_us_voice(voice)]
    wavenet_voices = [voice for voice in response.voices if "Wavenet" in voice.name and is_gb_us_voice(voice)]
    neural2_voices = [voice for voice in response.voices if "Neural2" in voice.name and is_gb_us_voice(voice)]
    
    return {
        "Journey": sorted(journey_voices, key=lambda x: x.name),
        "WaveNet": sorted(wavenet_voices, key=lambda x: x.name),
        "Neural2": sorted(neural2_voices, key=lambda x: x.name)
    }

def display_voice_options(voices_dict):
    print("\nAvailable GB and US English Voice Models:")
    current_index = 1
    voice_map = {}
    
    for category, voice_list in voices_dict.items():
        print(f"\n=== {category} Voices ===")
        for voice in voice_list:
            # Add region indicator (GB/US) to the display
            region = "GB" if "en-GB" in voice.language_codes else "US"
            gender = voice.ssml_gender.name if hasattr(voice.ssml_gender, 'name') else voice.ssml_gender
            
            # Check SSML support based on voice type
            if "Journey" in voice.name or "Neural2" in voice.name:
                ssml_support = "✓ Full SSML"
            elif "Wavenet" in voice.name:
                ssml_support = "~ Basic SSML"
            else:
                ssml_support = "✗ No SSML"
                
            print(f"{current_index}. {voice.name} ({region}, {gender}) [{ssml_support}]")
            voice_map[current_index] = voice
            current_index += 1
    
    return voice_map

def show_ssml_examples():
    print("\nSSML Examples (copy and modify these):")
    print("1. Basic SSML:")
    print('<speak>Hello, this is basic SSML text.</speak>')
    print("\n2. Add pauses:")
    print('<speak>Let\'s add a pause <break time="1s"/> of one second.</speak>')
    print("\n3. Emphasize words:")
    print('<speak>This is <emphasis level="strong">very important</emphasis>!</speak>')
    print("\n4. Change speaking rate:")
    print('<speak><prosody rate="slow">This is spoken slowly</prosody></speak>')
    print("\n5. Adjust pitch:")
    print('<speak><prosody pitch="high">This is spoken in a higher pitch</prosody></speak>')
    print("\n6. Multiple effects:")
    print('<speak>Normal speech, <break time="0.5s"/><prosody rate="slow" pitch="low">then slow and low</prosody></speak>')

def generate_speech(voice, text):
    client = texttospeech.TextToSpeechClient()
    
    # Check if the input is SSML (starts with <speak>)
    is_ssml = text.strip().startswith('<speak>')
    
    if is_ssml:
        synthesis_input = texttospeech.SynthesisInput(ssml=text)
    else:
        synthesis_input = texttospeech.SynthesisInput(text=text)
    
    # Use the voice's first language code (they only have one for these voices)
    voice_params = texttospeech.VoiceSelectionParams(
        language_code=voice.language_codes[0],
        name=voice.name
    )
    
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3
    )
    
    response = client.synthesize_speech(
        input=synthesis_input,
        voice=voice_params,
        audio_config=audio_config
    )
    
    output_file = os.path.join(os.path.dirname(__file__), f"tts_output_{voice.name}.mp3")
    with open(output_file, "wb") as out:
        out.write(response.audio_content)
        print(f'\nAudio content written to "{output_file}"')

def get_text_input():
    print("\nHow would you like to input text?")
    print("1. Type text/SSML directly")
    print("2. Read from file")
    choice = input("Enter choice (1 or 2): ").strip()
    
    if choice == "1":
        print("\nEnter text or SSML to convert to speech:")
        print("(Use SSML by wrapping text in <speak> tags, see examples above)")
        text = input("> ").strip()
        if not text:
            raise ValueError("Text cannot be empty")
        return text
    elif choice == "2":
        print("\nEnter the path to your SSML file (relative to current directory):")
        file_path = input("> ").strip()
        try:
            with open(file_path, 'r') as file:
                text = file.read().strip()
                if not text:
                    raise ValueError("File is empty")
                return text
        except FileNotFoundError:
            raise ValueError(f"File not found: {file_path}")
    else:
        raise ValueError("Invalid choice. Please enter 1 or 2.")

def main():
    # Get all available English premium voices
    voices_dict = get_english_premium_voices()
    
    # Show SSML examples at the start
    show_ssml_examples()
    
    while True:
        # Display voice options and get selection mapping
        voice_map = display_voice_options(voices_dict)
        
        # Get user selection
        try:
            print("\nEnter the number of the voice you want to use (or 'q' to quit):")
            choice = input("> ").strip()
            
            if choice.lower() == 'q':
                break
            
            choice = int(choice)
            if choice not in voice_map:
                print("\nInvalid selection. Please try again.")
                continue
            
            # Get the text to synthesize (either direct input or from file)
            try:
                text = get_text_input()
            except ValueError as e:
                print(f"\nError: {str(e)}")
                continue
            
            # Generate speech with selected voice
            selected_voice = voice_map[choice]
            print(f"\nGenerating speech using {selected_voice.name}...")
            generate_speech(selected_voice, text)
            
            # Ask if user wants to try another voice
            print("\nWould you like to try another voice? (y/n)")
            if input("> ").strip().lower() != 'y':
                break
                
        except ValueError:
            print("\nInvalid input. Please enter a number or 'q' to quit.")
        except Exception as e:
            print(f"\nAn error occurred: {str(e)}")
            break

if __name__ == "__main__":
    main() 