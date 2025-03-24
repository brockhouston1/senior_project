import boto3
from contextlib import closing

def text_to_speech(text, output_file="speech.mp3"):
    # Create a client using your AWS credentials
    polly_client = boto3.client('polly')
    
    try:
        # Request speech synthesis with Michael-Neural voice
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
    
    except Exception as e:
        print(f"Error: {str(e)}")

# Test the function
if __name__ == "__main__":
    test_text = input("Enter the text you want Michael to say: ")
    text_to_speech(test_text)
