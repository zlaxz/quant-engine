# Bicameral Analysis Implementation Plan

**Goal:** Toggle-able deep reasoning with DeepSeek Speciale as equal partner to Gemini

---

## UI Design

**Toggle Button in Chat Interface:**
```
[💬 Chat] [🧠 Deep Analysis Mode] ← Toggle button
                   ↑
            When ON: Adds Speciale
```

**When Enabled:**
```
User types question → Send button shows "Analyze Deeply"
  ↓
Both Gemini + Speciale analyze in parallel
  ↓
UI shows BOTH responses side-by-side:

┌────────────────────────────────┐
│ 🌟 Gemini 3 Pro                │
│ Data-driven, tool-based         │
│ Response: ...                   │
└────────────────────────────────┘

┌────────────────────────────────┐
│ 🔮 DeepSeek Speciale           │
│ Pure logic, GPT-5 level         │
│ Reasoning Chain: ...            │
│ Conclusion: ...                 │
└────────────────────────────────┘
```

---

## Implementation

### 1. Add Toggle State

**File:** `src/contexts/ChatContext.tsx`

```typescript
interface ChatContextType {
  selectedSessionId: string | null;
  selectedWorkspaceId: string | null;
  setSelectedSession: (sessionId: string | null, workspaceId: string | null) => void;
  activeExperiment: ActiveExperiment | null;
  setActiveExperiment: (experiment: ActiveExperiment | null) => void;
  // NEW:
  deepAnalysisMode: boolean;
  toggleDeepAnalysis: () => void;
}

// In provider:
const [deepAnalysisMode, setDeepAnalysisMode] = useState(false);
const toggleDeepAnalysis = () => setDeepAnalysisMode(prev => !prev);
```

### 2. Add Toggle UI

**File:** `src/components/chat/ChatArea.tsx`

```tsx
// Near send button
const { deepAnalysisMode, toggleDeepAnalysis } = useChatContext();

<div className="flex gap-2">
  <Button
    variant={deepAnalysisMode ? "default" : "outline"}
    size="sm"
    onClick={toggleDeepAnalysis}
  >
    {deepAnalysisMode ? "🔮 Deep Mode ON" : "💬 Normal Mode"}
  </Button>
  <Button onClick={sendMessage}>
    {deepAnalysisMode ? "Analyze Deeply" : "Send"}
  </Button>
</div>
```

### 3. Parallel Analysis Handler

**File:** `src/electron/ipc-handlers/llmClient.ts`

```typescript
// New handler for bicameral analysis
ipcMain.handle('chat-bicameral', async (_event, messagesRaw: unknown, deepMode: boolean) => {
  const messages = validateIPC(ChatMessagesSchema, messagesRaw, 'chat messages');

  if (!deepMode) {
    // Normal Gemini-only path
    return chatPrimary(messages);
  }

  // PARALLEL ANALYSIS
  const [geminiResponse, specialeResponse] = await Promise.all([
    // Gemini (with tools, data)
    chatPrimary(messages),

    // DeepSeek Speciale (pure reasoning)
    callDeepSeekSpeciale(messages)
  ]);

  return {
    bicameral: true,
    gemini: geminiResponse,
    speciale: specialeResponse
  };
});

async function callDeepSeekSpeciale(messages: any[]) {
  const deepseekClient = getDeepSeekClient();
  const lastMessage = messages[messages.length - 1];

  // Call Speciale URL with reasoning mode
  const completion = await fetch('https://api.deepseek.com/v3.2_speciale_expires_on_20251215/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-reasoner',
      messages: [{ role: 'user', content: lastMessage.content }],
      temperature: 0.7,
      max_tokens: 8000
    })
  });

  const data = await completion.json();

  return {
    content: data.choices[0].message.content,
    reasoning: data.choices[0].message.reasoning_content || '',
    provider: 'deepseek-speciale',
    model: 'deepseek-reasoner',
    tokens: data.usage?.total_tokens
  };
}
```

### 4. Dual Response UI Component

**File:** `src/components/chat/BicameralResponse.tsx` (NEW)

```tsx
interface BicameralResponseProps {
  gemini: { content: string; provider: string };
  speciale: { content: string; reasoning: string; tokens: number };
}

export function BicameralResponse({ gemini, speciale }: BicameralResponseProps) {
  const [showReasoning, setShowReasoning] = useState(true);

  return (
    <div className="space-y-4">
      {/* Gemini Perspective */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-emerald-500" />
            Gemini 3 Pro (Data-Driven Analysis)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap">{gemini.content}</p>
        </CardContent>
      </Card>

      {/* DeepSeek Speciale Perspective */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            DeepSeek Speciale (Pure Logic)
            <Badge variant="secondary">{speciale.tokens} tokens</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {showReasoning && speciale.reasoning && (
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="text-xs font-semibold mb-2">🧠 Reasoning Chain:</div>
              <p className="text-sm whitespace-pre-wrap">{speciale.reasoning}</p>
            </div>
          )}
          <div>
            <div className="text-xs font-semibold mb-2">💡 Conclusion:</div>
            <p className="whitespace-pre-wrap">{speciale.content}</p>
          </div>
        </CardContent>
      </Card>

      {/* Synthesis Section (Optional) */}
      <Card className="border-2 border-primary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            Synthesis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Both perspectives considered. Review above for agreement/disagreement points.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 5. Update ChatArea to Use Bicameral

**Modify sendMessage function:**

```typescript
const response = deepAnalysisMode
  ? await chatBicameral(llmMessages, true)  // Parallel analysis
  : await chatPrimary(llmMessages);         // Normal Gemini

if (response.bicameral) {
  // Show dual response
  const bicameralMessage: Message = {
    id: `bicameral-${Date.now()}`,
    role: 'bicameral',  // Special type
    content: '',
    gemini: response.gemini,
    speciale: response.speciale
  };
  setMessages(prev => [...prev, bicameralMessage]);
} else {
  // Normal single response
  // ... existing code
}
```

---

## Benefits

**Cost:** $0.006 per deep analysis (incredibly cheap for GPT-5 level)
**Speed:** 78s (acceptable when YOU choose it)
**Quality:** Maximum reasoning + data-driven = best of both
**Control:** Toggle on when you want deep analysis, off for fast iteration

---

## Estimated Implementation

- Toggle state: 15 minutes
- IPC handler: 45 minutes
- UI component: 1 hour
- Integration: 30 minutes
- **Total: 2.5 hours**

**Result:** Click toggle → Get TWO AI minds debating your question → See both perspectives → Make informed decision

**Want me to build this now?**
