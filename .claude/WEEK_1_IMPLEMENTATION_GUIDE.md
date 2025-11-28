# Week 1 Implementation Guide: Critical UX Fixes
**Goal:** Fix the "interface experience sucks" problem
**Timeline:** 5 days
**Priority:** ⚠️ CRITICAL - Blocks family welfare

---

## Overview

This week focuses on making tool execution VISIBLE and responses STREAMING. No more black box → text dump pattern.

**What You'll Build:**
- Real-time tool execution blocks (like Claude Code CLI)
- Token-by-token streaming responses
- Iteration progress indicators

**Impact:**
- User can see agent working in real-time
- Responses feel responsive, not cut short
- Interface transforms from "unusable" to "excellent"

---

## Day 1-2: Real-Time Tool Visibility

### Goal
Show tool executions as they happen, not after the fact.

### Files to Modify

**1. `src/electron/ipc-handlers/llmClient.ts`**

Add progress events BEFORE and AFTER each tool execution:

```typescript
// Around line 300 (in tool execution loop)
// BEFORE executing tool:
event.sender.send('tool-progress', {
  type: 'tool-start',
  tool: toolCall.name,
  args: toolCall.args,
  iteration: currentIteration,
  timestamp: Date.now()
});

// Execute tool
const toolResult = await executeTool(toolCall.name, toolCall.args, event);

// AFTER executing tool:
event.sender.send('tool-progress', {
  type: 'tool-complete',
  tool: toolCall.name,
  success: toolResult.success,
  preview: toolResult.content.slice(0, 200),
  duration: Date.now() - startTime,
  timestamp: Date.now()
});

// If tool errors:
if (!toolResult.success) {
  event.sender.send('tool-progress', {
    type: 'tool-error',
    tool: toolCall.name,
    error: toolResult.error,
    timestamp: Date.now()
  });
}
```

**2. `src/electron/preload.ts`**

Expose the progress listener to renderer:

```typescript
// Add to contextBridge.exposeInMainWorld('electron', {...})

onToolProgress: (callback: (progress: any) => void) => {
  const subscription = (_event: any, progress: any) => callback(progress);
  ipcRenderer.on('tool-progress', subscription);

  // Return unsubscribe function
  return () => ipcRenderer.removeListener('tool-progress', subscription);
},
```

**3. `src/types/electron.d.ts`**

Add type definitions:

```typescript
interface ElectronAPI {
  // Existing methods...

  onToolProgress: (callback: (progress: ToolProgress) => void) => () => void;
}

interface ToolProgress {
  type: 'tool-start' | 'tool-complete' | 'tool-error' | 'iteration-update';
  tool?: string;
  args?: Record<string, any>;
  success?: boolean;
  preview?: string;
  duration?: number;
  iteration?: number;
  maxIterations?: number;
  message?: string;
  timestamp: number;
}
```

**4. `src/components/chat/ChatArea.tsx`**

Listen for progress events and display them:

```typescript
// Add state for tool progress
const [toolProgress, setToolProgress] = useState<ToolProgress[]>([]);

// Listen for progress events
useEffect(() => {
  const unsubscribe = window.electron.onToolProgress((progress) => {
    setToolProgress(prev => [...prev, progress]);
  });

  return () => unsubscribe();
}, []);

// Clear progress when starting new message
const sendMessage = async () => {
  setToolProgress([]);  // Clear previous progress
  // ... existing send logic
};

// Render progress blocks in message area
{toolProgress.map((progress, idx) => (
  <ToolProgressBlock
    key={idx}
    type={progress.type}
    tool={progress.tool}
    preview={progress.preview}
    duration={progress.duration}
    success={progress.success}
  />
))}
```

**5. Create `src/components/chat/ToolProgressBlock.tsx`**

```tsx
import { CheckCircle, Circle, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolProgressBlockProps {
  type: 'tool-start' | 'tool-complete' | 'tool-error';
  tool?: string;
  preview?: string;
  duration?: number;
  success?: boolean;
}

export const ToolProgressBlock = ({
  type,
  tool,
  preview,
  duration,
  success
}: ToolProgressBlockProps) => {
  const isRunning = type === 'tool-start';
  const isComplete = type === 'tool-complete';
  const isError = type === 'tool-error';

  return (
    <div className={cn(
      "flex items-start gap-2 p-3 rounded-lg border text-sm",
      isRunning && "border-blue-500 bg-blue-50",
      isComplete && success && "border-green-500 bg-green-50",
      isError && "border-red-500 bg-red-50"
    )}>
      <div className="mt-0.5">
        {isRunning && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
        {isComplete && success && <CheckCircle className="h-4 w-4 text-green-600" />}
        {isError && <XCircle className="h-4 w-4 text-red-600" />}
        {isComplete && !success && <Circle className="h-4 w-4 text-gray-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium">
          {isRunning && `🔧 ${tool}...`}
          {isComplete && `✓ ${tool}`}
          {isError && `✗ ${tool} failed`}
        </div>

        {preview && (
          <div className="text-xs text-gray-600 mt-1 truncate">
            {preview}
          </div>
        )}

        {duration && (
          <div className="text-xs text-gray-500 mt-1">
            {duration}ms
          </div>
        )}
      </div>
    </div>
  );
};
```

### Testing

1. Run the app: `npm run electron:dev`
2. Send a message that triggers tools (e.g., "List files in profiles/")
3. **Verify:** You see tool blocks appearing in real-time
4. **Verify:** Green checkmarks appear when tools complete
5. **Verify:** Preview text shows first 200 chars of result

### Success Criteria
- ✅ Tool executions visible in real-time
- ✅ No more 30-second black box
- ✅ User can see what agent is doing

---

## Day 3-4: Streaming Responses

### Goal
Stream responses token-by-token instead of dumping complete response.

### Files to Modify

**1. `src/electron/ipc-handlers/llmClient.ts`**

Enable Gemini streaming:

```typescript
// Around line 270 (where you call generateContent)

// BEFORE (batch):
// const result = await model.generateContent({...});

// AFTER (streaming):
const result = await model.generateContentStream({
  contents: messages,
  tools: ALL_TOOLS,
  toolConfig: {
    functionCallingConfig: {
      mode: 'ANY' as any,
      allowedFunctionNames: ALL_TOOLS.map(t => t.name)
    }
  },
  generationConfig: {
    // Enable streaming function call arguments (Gemini 3 Pro+)
    streamFunctionCallArguments: true
  }
});

// Stream chunks to renderer
let accumulatedText = '';
for await (const chunk of result.stream) {
  const text = chunk.text();
  if (text) {
    accumulatedText += text;
    event.sender.send('stream-chunk', {
      content: text,
      done: false
    });
  }

  // Handle function calls in chunks
  const functionCalls = chunk.functionCalls();
  if (functionCalls) {
    // Process tool calls (existing logic)
  }
}

// Signal completion
event.sender.send('stream-chunk', { done: true });
```

**2. `src/electron/preload.ts`**

Expose stream listener:

```typescript
onStreamChunk: (callback: (chunk: any) => void) => {
  const subscription = (_event: any, chunk: any) => callback(chunk);
  ipcRenderer.on('stream-chunk', subscription);
  return () => ipcRenderer.removeListener('stream-chunk', subscription);
},
```

**3. `src/types/electron.d.ts`**

Add type:

```typescript
interface ElectronAPI {
  // Existing...
  onStreamChunk: (callback: (chunk: StreamChunk) => void) => () => void;
}

interface StreamChunk {
  content?: string;
  done: boolean;
  error?: string;
}
```

**4. `src/components/chat/ChatArea.tsx`**

Accumulate streaming content:

```typescript
const [streamingContent, setStreamingContent] = useState('');
const [isStreaming, setIsStreaming] = useState(false);

// Listen for stream chunks
useEffect(() => {
  const unsubscribe = window.electron.onStreamChunk((chunk) => {
    if (chunk.error) {
      toast({
        title: 'Streaming Error',
        description: chunk.error,
        variant: 'destructive'
      });
      setIsStreaming(false);
      return;
    }

    if (chunk.done) {
      // Finalize message
      const finalMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: streamingContent,
        created_at: new Date().toISOString()
      };

      setMessages(prev => [...prev, finalMessage]);
      setStreamingContent('');
      setIsStreaming(false);

      // Save to DB
      if (selectedSessionId) {
        supabase.from('messages').insert([{
          session_id: selectedSessionId,
          ...finalMessage
        }]);
      }
    } else {
      // Accumulate chunk
      setStreamingContent(prev => prev + chunk.content);
    }
  });

  return () => unsubscribe();
}, [streamingContent, selectedSessionId]);

// Display streaming content
{isStreaming && streamingContent && (
  <div className="flex justify-start">
    <div className="max-w-[80%] rounded-lg p-3 bg-blue-50 border border-blue-200">
      <div className="prose prose-sm">
        {streamingContent}
        <span className="inline-block w-2 h-4 bg-blue-600 animate-pulse ml-1" />
      </div>
    </div>
  </div>
)}
```

### Testing

1. Send a message requiring a long response
2. **Verify:** Response appears token-by-token
3. **Verify:** Blinking cursor at end of streaming text
4. **Verify:** Response feels "live" not dumped
5. **Verify:** Final message saved to DB correctly

### Success Criteria
- ✅ Responses stream in real-time
- ✅ No more "complete silence → text dump"
- ✅ Feels responsive and natural

---

## Day 5: Iteration Progress Display

### Goal
Show "Iteration X/15" during multi-step agentic workflows.

### Files to Modify

**1. `src/electron/ipc-handlers/llmClient.ts`**

Add iteration progress events:

```typescript
// In the tool execution loop (around line 290)
for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
  // Send iteration progress
  event.sender.send('tool-progress', {
    type: 'iteration-update',
    iteration: iteration + 1,
    maxIterations: MAX_TOOL_ITERATIONS,
    message: `Processing tools...`,
    timestamp: Date.now()
  });

  // ... existing tool execution logic
}
```

**2. `src/components/chat/ChatArea.tsx`**

Display iteration counter:

```typescript
// Add to render (above tool progress blocks)
{toolProgress.filter(p => p.type === 'iteration-update').slice(-1).map(progress => (
  <div className="text-xs text-gray-500 font-mono mb-2">
    Iteration {progress.iteration}/{progress.maxIterations}
  </div>
))}
```

### Testing

1. Send a message requiring multiple tool calls (e.g., "Analyze all profiles and compare")
2. **Verify:** Iteration counter appears and updates
3. **Verify:** Shows "Iteration 1/10", "Iteration 2/10", etc.

### Success Criteria
- ✅ Iteration progress visible
- ✅ User knows agent is making progress
- ✅ No confusion about whether agent is stuck

---

## Integration Testing (End of Week 1)

### Test Scenarios

**Scenario 1: Simple File Read**
```
User: "Read profiles/skew.py"
Expected:
  - [Tool Block] 🔧 read_file(path="profiles/skew.py")... [spinning]
  - [Tool Block] ✓ read_file [green checkmark] [preview: "# Skew Profile\n..."]
  - [Streaming] Response text appears token-by-token
```

**Scenario 2: Multi-Tool Workflow**
```
User: "List profiles directory and read the first file"
Expected:
  - Iteration 1/10
  - [Tool Block] 🔧 list_directory... [spinning]
  - [Tool Block] ✓ list_directory [preview: "skew.py, vanna.py..."]
  - Iteration 2/10
  - [Tool Block] 🔧 read_file... [spinning]
  - [Tool Block] ✓ read_file
  - [Streaming] Response text...
```

**Scenario 3: Parallel Agents**
```
User: "Compare skew.py and vanna.py"
Expected:
  - Iteration 1/10
  - [Tool Block] 🔧 spawn_agents_parallel(agents=[...]) [spinning]
  - [Tool Block] ✓ spawn_agents_parallel [preview: "Agent 1: ..., Agent 2: ..."]
  - [Streaming] Comparison analysis...
```

### Performance Targets

- First tool event: <50ms after tool starts
- First stream chunk: <200ms after LLM starts generating
- Total perceived latency: 50-70% reduction vs current (batch mode)

---

## Rollback Plan

If streaming breaks critical functionality:

1. Add feature flag: `ENABLE_STREAMING=false` in .env
2. Fallback to batch mode in llmClient.ts:
   ```typescript
   const useStreaming = process.env.ENABLE_STREAMING !== 'false';
   if (useStreaming) {
     // Streaming code
   } else {
     // Original batch code
   }
   ```
3. Test both modes work

---

## Common Issues & Solutions

### Issue 1: IPC Events Not Received
**Symptom:** Tool blocks don't appear
**Debug:**
```typescript
// In preload.ts
onToolProgress: (callback) => {
  ipcRenderer.on('tool-progress', (_event, progress) => {
    console.log('[Preload] Tool progress:', progress);  // Add logging
    callback(progress);
  });
  // ...
}
```
**Solution:** Verify preload script is loaded (check console for logs)

### Issue 2: Streaming Chunks Out of Order
**Symptom:** Text appears jumbled
**Debug:** Check if multiple stream listeners exist
**Solution:** Ensure useEffect cleanup returns unsubscribe function

### Issue 3: Memory Leak from Event Listeners
**Symptom:** App slows down over time
**Debug:** Check Chrome DevTools memory profiler
**Solution:** Always return cleanup function from useEffect

---

## Week 1 Deliverables

- [ ] Tool execution blocks showing in real-time
- [ ] Responses streaming token-by-token
- [ ] Iteration progress visible
- [ ] No more "black box" feeling
- [ ] User feedback: "Interface feels responsive"

---

## Next Steps (Week 2 Preview)

After Week 1, you'll have a **responsive interface**. Week 2 will add:
- Orchestrator pattern (task decomposition)
- Specialized agents (Code, Backtest, Analysis, Memory)
- Parallel agent coordination

But Week 1 is the **foundation** - without visible, streaming responses, nothing else matters.

Let's fix the UX first. 🚀
