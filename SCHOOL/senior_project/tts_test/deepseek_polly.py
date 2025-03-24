import boto3
import os
from contextlib import closing
from dotenv import load_dotenv
from openai import OpenAI
import time

# Load environment variables from .env file
load_dotenv()

# Function to call Deepseek v3 API using OpenAI client
def generate_text(prompt):
    # Get API key from environment variables
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    
    if not api_key:
        raise ValueError("DEEPSEEK_API_KEY environment variable not set")
    
    # Initialize the OpenAI client with Deepseek's base URL
    client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
    
    try:
        # Create chat completion using OpenAI-compatible format
        response = client.chat.completions.create(
            model="deepseek-chat",  # Use the appropriate model name
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=1.0,
            max_tokens=200,  # Reduced from 500
            top_p=0.9,
            frequency_penalty=0,
            presence_penalty=0,
            stream=True  # Changed to True to enable streaming
        )
        
        # Process streaming response
        collected_chunks = []
        collected_response = ""
        
        # Display tokens as they arrive
        print("\nResponse streaming:")
        for chunk in response:
            chunk_content = chunk.choices[0].delta.content
            if chunk_content is not None:
                print(chunk_content, end="", flush=True)
                collected_chunks.append(chunk_content)
                collected_response += chunk_content
        print("\n")
        
        return collected_response
    
    except Exception as e:
        print(f"Error calling Deepseek API: {str(e)}")
        return None

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

# Main function to run the workflow
def main():
    user_prompt = input("Enter your prompt for Deepseek: ")
    print("Generating response from Deepseek...")
    
    # Start timing
    start_time = time.time()
    
    # Get response from Deepseek
    ai_response = generate_text(user_prompt)
    
    # Calculate elapsed time
    elapsed_time = time.time() - start_time
    
    if ai_response:
        print("\nDeepseek response (took {:.2f} seconds):".format(elapsed_time))
        print(ai_response)
        print(f"\nResponse time: {elapsed_time:.2f} seconds")
    else:
        print("Failed to get a response from Deepseek")

if __name__ == "__main__":
    main() 