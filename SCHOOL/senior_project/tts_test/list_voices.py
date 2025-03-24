from google.cloud import texttospeech
import os

# Set the credentials environment variable
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(os.path.dirname(__file__), "credentials.json")

def list_english_premium_voices():
    client = texttospeech.TextToSpeechClient()
    
    # List all available voices
    response = client.list_voices()
    
    # Function to print voice details
    def print_voice_details(voice):
        print(f"\nName: {voice.name}")
        print(f"Language codes: {voice.language_codes}")
        print(f"Gender: {voice.ssml_gender}")
        print(f"Natural sample rate hertz: {voice.natural_sample_rate_hertz}")
    
    # Function to filter English voices
    def is_english_voice(voice):
        return any(lang.startswith('en-') for lang in voice.language_codes)
    
    # Filter and print Journey voices
    print("\n=== English Journey Voices ===")
    journey_voices = [voice for voice in response.voices if "Journey" in voice.name and is_english_voice(voice)]
    for voice in sorted(journey_voices, key=lambda x: x.name):
        print_voice_details(voice)
    
    # Filter and print WaveNet voices
    print("\n=== English WaveNet Voices ===")
    wavenet_voices = [voice for voice in response.voices if "Wavenet" in voice.name and is_english_voice(voice)]
    for voice in sorted(wavenet_voices, key=lambda x: x.name):
        print_voice_details(voice)
    
    # Filter and print Neural2 voices
    print("\n=== English Neural2 Voices ===")
    neural2_voices = [voice for voice in response.voices if "Neural2" in voice.name and is_english_voice(voice)]
    for voice in sorted(neural2_voices, key=lambda x: x.name):
        print_voice_details(voice)

if __name__ == "__main__":
    list_english_premium_voices() 