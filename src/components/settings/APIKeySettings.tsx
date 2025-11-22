import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Save } from 'lucide-react';

export function APIKeySettings() {
  const { toast } = useToast();
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [showGemini, setShowGemini] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [showDeepseek, setShowDeepseek] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAPIKeys();
  }, []);

  const loadAPIKeys = async () => {
    try {
      if (window.electron && 'getAPIKeys' in window.electron) {
        const keys = await window.electron.getAPIKeys();
        if (keys) {
          setGeminiKey(keys.gemini || '');
          setOpenaiKey(keys.openai || '');
          setDeepseekKey(keys.deepseek || '');
        }
      }
    } catch (error) {
      console.error('Failed to load API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      if (window.electron && 'setAPIKeys' in window.electron) {
        await window.electron.setAPIKeys({
          gemini: geminiKey,
          openai: openaiKey,
          deepseek: deepseekKey,
        });
        
        toast({
          title: 'API Keys Saved',
          description: 'Your API keys have been securely saved.',
        });
      }
    } catch (error) {
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save API keys',
        variant: 'destructive',
      });
    }
  };

  const maskKey = (key: string) => {
    if (!key || key.length < 8) return key;
    return key.slice(0, 4) + '•'.repeat(key.length - 8) + key.slice(-4);
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Google Gemini API Key</CardTitle>
          <CardDescription>
            Used for PRIMARY tier (main research chat, synthesis)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gemini-key">API Key</Label>
            <div className="flex gap-2">
              <Input
                id="gemini-key"
                type={showGemini ? 'text' : 'password'}
                value={showGemini ? geminiKey : maskKey(geminiKey)}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="Enter your Gemini API key"
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowGemini(!showGemini)}
              >
                {showGemini ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OpenAI API Key</CardTitle>
          <CardDescription>
            Used for SECONDARY tier and embeddings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="openai-key">API Key</Label>
            <div className="flex gap-2">
              <Input
                id="openai-key"
                type={showOpenai ? 'text' : 'password'}
                value={showOpenai ? openaiKey : maskKey(openaiKey)}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="Enter your OpenAI API key"
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowOpenai(!showOpenai)}
              >
                {showOpenai ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>DeepSeek API Key</CardTitle>
          <CardDescription>
            Used for SWARM tier (parallel agent modes)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="deepseek-key">API Key</Label>
            <div className="flex gap-2">
              <Input
                id="deepseek-key"
                type={showDeepseek ? 'text' : 'password'}
                value={showDeepseek ? deepseekKey : maskKey(deepseekKey)}
                onChange={(e) => setDeepseekKey(e.target.value)}
                placeholder="Enter your DeepSeek API key"
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowDeepseek(!showDeepseek)}
              >
                {showDeepseek ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} className="w-full">
        <Save className="mr-2 h-4 w-4" />
        Save API Keys
      </Button>
    </div>
  );
}
