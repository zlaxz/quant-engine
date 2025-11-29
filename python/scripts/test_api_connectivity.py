import subprocess
import pytest

def test_curl_deepseek():
    api_key = "sk-43c4e2d7810b4ca6b80a5b4596c43a21"
    cmd = [
        "curl", "-s", "https://api.deepseek.com/chat/completions",
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {api_key}",
        "-d", '{"model": "deepseek-chat", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 5}'
    ]
    
    # Run curl
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    print("\n--- CURL OUTPUT ---")
    print(result.stdout)
    print("--- CURL ERROR ---")
    print(result.stderr)
    
    if result.returncode != 0:
        raise Exception(f"Curl failed with code {result.returncode}")
        
    if "choices" not in result.stdout:
        raise Exception(f"Invalid API Response: {result.stdout}")
