#!/usr/bin/env python3
"""Test DeepSeek Speciale response time"""
import subprocess
import json
import time
import os

DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY')
SPECIALE_URL = 'https://api.deepseek.com/v3.2_speciale_expires_on_20251215/chat/completions'

# Complex reasoning question
question = """Analyze the theoretical soundness of a vanna options strategy: profiting from volatility-spot correlation changes.

What are:
1. The hidden assumptions
2. Conditions where it breaks
3. Market conditions required for edge
4. Second-order effects

Provide rigorous logical analysis with causal chains."""

payload = json.dumps({
    'model': 'deepseek-reasoner',
    'messages': [{'role': 'user', 'content': question}],
    'temperature': 0.7,
    'max_tokens': 8000
})

print("Testing DeepSeek Speciale...")
print(f"Question length: {len(question)} chars")
print()

start = time.time()

result = subprocess.run([
    'curl', '-s', SPECIALE_URL,
    '-H', 'Content-Type: application/json',
    '-H', f'Authorization: Bearer {DEEPSEEK_API_KEY}',
    '-d', payload
], capture_output=True, text=True, timeout=120)

elapsed = time.time() - start

if result.returncode != 0:
    print(f"ERROR: curl failed\n{result.stderr}")
    exit(1)

try:
    data = json.loads(result.stdout)

    if 'choices' not in data:
        print(f"ERROR: {data}")
        exit(1)

    response = data['choices'][0]['message']['content']
    reasoning = data['choices'][0]['message'].get('reasoning_content', '')

    print("=" * 70)
    print("DEEPSEEK SPECIALE RESPONSE")
    print("=" * 70)

    if reasoning:
        print(f"\n📊 REASONING CHAIN ({len(reasoning)} chars):")
        print(reasoning[:800] + "..." if len(reasoning) > 800 else reasoning)
        print()

    print(f"💡 FINAL ANSWER ({len(response)} chars):")
    print(response[:1200] + "..." if len(response) > 1200 else response)

    print()
    print("=" * 70)
    print("METRICS")
    print("=" * 70)
    print(f"⏱️  Response time: {elapsed:.2f}s")
    print(f"🔢 Total tokens: {data.get('usage', {}).get('total_tokens', 'unknown')}")
    print(f"📝 Response length: {len(response)} chars")
    print(f"🧠 Reasoning length: {len(reasoning)} chars")
    print(f"💰 Reasoning cost: ~${data.get('usage', {}).get('total_tokens', 0) * 0.0014 / 1000:.4f}")

except json.JSONDecodeError as e:
    print(f"JSON parse error: {e}")
    print(f"Response: {result.stdout[:500]}")
