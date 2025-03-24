import boto3
import os
import time
import requests
from contextlib import closing
from dotenv import load_dotenv
import json

# Load environment variables
load_dotenv()

def generate_text_with_ollama(prompt, model="llama3:8b"):
    """Generate text using a locally running Ollama model with streaming output"""
    try:
        start_time = time.time()
        
        response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": True  # Changed to True to enable streaming
            },
            stream=True  # Enable streaming in requests
        )
        
        if response.status_code == 200:
            full_response = ""
            print("\nStreaming response:")
            
            for line in response.iter_lines():
                if line:
                    # Each line is a JSON object
                    chunk = json.loads(line.decode('utf-8'))
                    
                    # Print the response piece
                    if 'response' in chunk:
                        print(chunk['response'], end='', flush=True)
                        full_response += chunk['response']
                    
                    # Check for the done status
                    if chunk.get('done', False):
                        break
            
            print("\n")  # Add a new line after streaming completes
            elapsed = time.time() - start_time
            return full_response, elapsed
        else:
            print(f"Error: {response.status_code}")
            return None, 0
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
    
    # Get response from local model
    ai_response, elapsed_time = generate_text_with_ollama(user_prompt)
    
    if ai_response:
        print(f"\nResponse (took {elapsed_time:.2f} seconds):")
        print(ai_response)
        
        # Ask if user wants to convert to speech
        convert = input("\nConvert to speech? (y/n): ").lower()
        if convert == 'y':
            text_to_speech(ai_response)
    else:
        print("Failed to get a response")

if __name__ == "__main__":
    main() 