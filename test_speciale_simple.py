#!/usr/bin/env python3
"""Test DeepSeek Speciale - Proper Implementation"""
import requests
import time
import os
import json

API_KEY = os.environ.get('DEEPSEEK_API_KEY')
SPECIALE_URL = 'https://api.deepseek.com/v3.2_speciale_expires_on_20251215/chat/completions'

question = "Analyze vanna trade: volatility-spot correlation edge. What assumptions? When does it break? Logical analysis."

print(f"Testing DeepSeek Speciale...")
print(f"URL: {SPECIALE_URL}")
print(f"Question: {question}")
print()

start_time = time.time()

response = requests.post(
    SPECIALE_URL,
    headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {API_KEY}'
    },
    json={
        'model': 'deepseek-reasoner',
        'messages': [{'role': 'user', 'content': question}],
        'temperature': 0.7,
        'max_tokens': 4000
    },
    timeout=180
)

elapsed = time.time() - start_time

print(f"⏱️  Response time: {elapsed:.2f}s")
print(f"📡 Status: {response.status_code}")
print()

if response.status_code == 200:
    data = response.json()
    content = data['choices'][0]['message']['content']
    reasoning = data['choices'][0]['message'].get('reasoning_content', '')

    print("=" * 60)
    if reasoning:
        print(f"🧠 REASONING ({len(reasoning)} chars):")
        print(reasoning[:500])
        print()

    print(f"💡 ANSWER ({len(content)} chars):")
    print(content[:800])
    print()
    print(f"🔢 Tokens: {data.get('usage', {}).get('total_tokens')}")
else:
    print(f"ERROR: {response.text}")
