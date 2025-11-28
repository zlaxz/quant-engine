/**
 * Demo Data - Sample data for showcasing visual enhancements
 */

import type { AgentSpawn, ToolCall, Memory, OperationPhase, TimelineEvent } from '@/components/research';

export const getDemoMemoryRecalls = (): Memory[] => [
  {
    id: 'mem1',
    content: 'Convexity profiles represent different option strategy payoffs - gamma, vega, theta exposures',
    category: 'Strategy',
    importance: 0.9,
    tags: ['convexity', 'options']
  },
  {
    id: 'mem2',
    content: 'Rotation engine pairs profiles with market regimes: high vol → long gamma, low vol → short gamma',
    category: 'Risk',
    importance: 0.85,
    tags: ['regime', 'pairing']
  },
  {
    id: 'mem3',
    content: 'Short gamma strategies have negative convexity - losses accelerate nonlinearly',
    category: 'Warning',
    importance: 0.95,
    tags: ['risk', 'short-gamma']
  }
];

export const getDemoAgents = (): AgentSpawn[] => [
  {
    id: 'agent1',
    role: 'Code Analyzer',
    status: 'completed',
    task: 'Reading profiles.py',
    tools: ['read_file', 'search_code'],
    startTime: Date.now() - 5000,
    endTime: Date.now() - 2000
  },
  {
    id: 'agent2',
    role: 'Pattern Detector',
    status: 'working',
    task: 'Finding regime-profile patterns',
    tools: ['search_code'],
    startTime: Date.now() - 3000
  }
];

export const getDemoToolCallTree = (): ToolCall[] => [
  {
    id: 'tool1',
    tool: 'batch_backtest',
    args: { 
      strategy: 'short_put_otm',
      start_date: '2023-01-01',
      end_date: '2023-12-31',
      profiles: ['profile_1', 'profile_2', 'profile_3']
    },
    result: 'Analyzed 247 days across 3 profiles. Best Sharpe: 1.85 (profile_2)',
    timestamp: Date.now() - 8000,
    success: true,
    duration: 3200,
    children: [
      {
        id: 'tool2',
        tool: 'read_file',
        args: { filePath: '/strategies/short_put_otm.py' },
        result: 'Strategy code loaded: 156 lines, 4 parameters defined',
        timestamp: Date.now() - 7500,
        success: true,
        duration: 120,
      },
      {
        id: 'tool3',
        tool: 'inspect_market_data',
        args: { 
          symbol: 'SPX',
          start: '2023-01-01',
          end: '2023-01-31',
          data_type: 'options_chain'
        },
        result: 'Found 23 trading days, 1,247 option contracts per day, no gaps detected',
        timestamp: Date.now() - 6800,
        success: true,
        duration: 450,
      },
      {
        id: 'tool4',
        tool: 'get_trade_log',
        args: { runId: 'run_abc123' },
        result: 'Retrieved 47 trades: 32 winners (68%), avg P&L: +$127',
        timestamp: Date.now() - 5200,
        success: true,
        duration: 210,
      }
    ]
  }
];

export const getDemoOperationPhases = (): OperationPhase[] => [
  { name: 'Reading codebase', progress: 100, status: 'completed', eta: 0 },
  { name: 'Analyzing profiles', progress: 70, status: 'active', eta: 3 },
  { name: 'Synthesizing response', progress: 0, status: 'pending' }
];

export const getDemoTimelineEvents = (): TimelineEvent[] => [
  {
    id: 'evt1',
    type: 'message',
    title: 'User Question',
    description: 'Analyzing convexity profiles',
    timestamp: Date.now() - 6000
  },
  {
    id: 'evt2',
    type: 'tool',
    title: 'list_directory',
    description: 'Found 5 profile files',
    timestamp: Date.now() - 4500
  },
  {
    id: 'evt3',
    type: 'tool',
    title: 'read_file',
    description: 'Read profiles.py (450 lines)',
    timestamp: Date.now() - 3000
  },
  {
    id: 'evt4',
    type: 'finding',
    title: 'Discovery',
    description: '8 convexity profiles found with regime mapping logic',
    timestamp: Date.now() - 1500,
    stage: 'Analysis'
  }
];

export const getDemoThinkingText = () => 
  'Analyzing convexity profile structure...\nLONG_GAMMA and SHORT_GAMMA are inverse payoffs...\nRegime mapping logic appears in line 145-180...\nNeed to explain nonlinear risk for ADHD user...';
