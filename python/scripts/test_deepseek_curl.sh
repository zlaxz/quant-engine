#!/bin/bash
# Direct Curl Test for DeepSeek API
API_KEY="sk-43c4e2d7810b4ca6b80a5b4596c43a21"

echo "Testing DeepSeek API via Curl..."
curl -v https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
        "model": "deepseek-chat",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 5
      }'
