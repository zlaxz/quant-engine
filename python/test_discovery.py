#!/usr/bin/env python3
"""Test autonomous discovery phase."""
import asyncio
import os
import sys

# Set env vars
os.environ['SUPABASE_URL'] = 'https://ynaqtawyynqikfyranda.supabase.co'
os.environ['SUPABASE_KEY'] = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InluYXF0YXd5eW5xaWtmeXJhbmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1NzM5NjMsImV4cCI6MjA3OTE0OTk2M30.VegcJvLluy8toSYqnR7Ufc5jx5XAl1-XeDRl8KbsIIw'
os.environ['DATA_DIR'] = '/Volumes/VelocityData/velocity_om/parquet'

from daemon import ResearchDirector, DaemonConfig

async def run():
    config = DaemonConfig(discovery_interval=60)
    director = ResearchDirector(config)

    print('='*60)
    print('AUTONOMOUS DISCOVERY TEST')
    print('='*60)

    result = await director.run_discovery_phase()

    print(f"\nAction: {result.get('action')}")
    print(f"Discoveries: {result.get('discoveries', 0)}")
    print(f"Missions created: {result.get('missions_created', 0)}")

    if result.get('opportunities'):
        print("\nOpportunities:")
        for opp in result['opportunities']:
            print(f"  - {opp}")

if __name__ == '__main__':
    asyncio.run(run())
