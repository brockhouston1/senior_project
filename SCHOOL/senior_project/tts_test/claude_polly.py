import boto3
import os
import time
import anthropic
from contextlib import closing
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def generate_text_with_claude(prompt):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable not set")
    
    client = anthropic.Anthropic(api_key=api_key)
    
    try:
        start_time = time.time()
        
        print("\nStreaming response:")
        
        # Use Claude Instant with streaming enabled
        with client.messages.stream(
            model="claude-instant-1.2",
            max_tokens=300,
            messages=[
                {"role": "user", "content": prompt}
            ]
        ) as stream:
            full_response = ""
            
            # Process the streaming response
            for text in stream.text_stream:
                print(text, end="", flush=True)
                full_response += text
        
        print("\n")  # Add a newline after streaming completes
        
        elapsed = time.time() - start_time
        return full_response, elapsed
    
    except Exception as e:
        print(f"Error: {str(e)}")
        return None, 0

def text_to_speech(text, output_file="speech.mp3"):
    # Create a client using your AWS credentials
    polly_client = boto3.client('polly')
    
    try:
        # Request speech synthesis with Matthew generative voice
        response = polly_client.synthesize_speech(
            Engine="generative",
            LanguageCode="en-US",
            OutputFormat="mp3",
            VoiceId="Matthew",
            Text=text
        )
        
        # Save the audio stream to a file
        if "AudioStream" in response:
            with closing(response["AudioStream"]) as stream:
                with open(output_file, "wb") as file:
                    file.write(stream.read())
                print(f"Audio saved successfully to {output_file}")
                return True
    
    except Exception as e:
        print(f"Error: {str(e)}")
        return False

# Main function 
def main():
    user_prompt = input("Enter your prompt: ")
    
    # Get response from Claude
    ai_response, elapsed_time = generate_text_with_claude(user_prompt)
    
    if ai_response:
        print(f"\nResponse completed in {elapsed_time:.2f} seconds")
        
        # Ask if user wants to convert to speech
        convert = input("\nConvert to speech? (y/n): ").lower()
        if convert == 'y':
            text_to_speech(ai_response)
    else:
        print("Failed to get a response")

if __name__ == "__main__":
    main() 