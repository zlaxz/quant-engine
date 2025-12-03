import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Save, RefreshCw, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export function APIKeySettings() {
  const { toast } = useToast();
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [showGemini, setShowGemini] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [showDeepseek, setShowDeepseek] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadAPIKeys();
  }, []);

  const loadAPIKeys = async () => {
    try {
      // First try to load from local Electron store
      if (window.electron && 'getAPIKeys' in window.electron) {
        const localKeys = await window.electron.getAPIKeys();
        if (localKeys?.gemini || localKeys?.openai || localKeys?.deepseek) {
          setGeminiKey(localKeys.gemini || '');
          setOpenaiKey(localKeys.openai || '');
          setDeepseekKey(localKeys.deepseek || '');
          setLoading(false);
          return;
        }
      }
      
      // If no local keys, try to sync from Supabase
      await syncFromSupabase();
    } catch (error) {
      console.error('Failed to load API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const syncFromSupabase = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-api-keys');
      
      if (error) {
        throw error;
      }
      
      if (data) {
        const hasKeys = data.gemini || data.openai || data.deepseek;
        
        if (hasKeys) {
          setGeminiKey(data.gemini || '');
          setOpenaiKey(data.openai || '');
          setDeepseekKey(data.deepseek || '');
          
          // Auto-save to Electron store
          if (window.electron && 'setAPIKeys' in window.electron) {
            await window.electron.setAPIKeys({
              gemini: data.gemini || '',
              openai: data.openai || '',
              deepseek: data.deepseek || '',
            });
          }
          
          toast({
            title: 'Keys Synced',
            description: 'API keys imported from Supabase and saved locally.',
          });
        } else {
          toast({
            title: 'No Keys Found',
            description: 'No API keys configured in Supabase secrets.',
            variant: 'destructive',
          });
        }
      }
    } catch (error) {
      console.error('Failed to sync from Supabase:', error);
      toast({
        title: 'Sync Failed',
        description: error instanceof Error ? error.message : 'Failed to fetch keys from Supabase',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
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
          description: 'Your API keys have been securely saved locally.',
        });
      } else {
        toast({
          title: 'Not in Electron',
          description: 'API keys can only be saved in the desktop app.',
          variant: 'destructive',
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
    return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">API Keys</h3>
          <p className="text-sm text-muted-foreground">
            Manage your LLM provider API keys
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={syncFromSupabase}
          disabled={syncing}
        >
          {syncing ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Sync from Supabase
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Google Gemini API Key
            {geminiKey && <Check className="h-4 w-4 text-green-500" />}
          </CardTitle>
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
          <CardTitle className="flex items-center gap-2">
            OpenAI API Key
            {openaiKey && <Check className="h-4 w-4 text-green-500" />}
          </CardTitle>
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
          <CardTitle className="flex items-center gap-2">
            DeepSeek API Key
            {deepseekKey && <Check className="h-4 w-4 text-green-500" />}
          </CardTitle>
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
        Save API Keys Locally
      </Button>
    </div>
  );
}
