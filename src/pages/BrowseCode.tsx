import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { FileCode2, Folder, Search, ChevronRight, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

export default function BrowseCode() {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('list-dir', {
        body: { path }
      });

      if (error) throw error;
      setFiles(data.files || []);
    } catch (error: any) {
      toast({
        title: "Error loading directory",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileClick = (file: any) => {
    if (file.type === 'directory') {
      setCurrentPath(file.path);
    } else {
      navigate(`/file/${encodeURIComponent(file.path)}`);
    }
  };

  const goBack = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  const searchCode = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('search-code', {
        body: { query: searchQuery, path: currentPath }
      });

      if (error) throw error;
      
      toast({
        title: "Search Results",
        description: `Found ${data.results?.length || 0} matches`
      });
      
      // Navigate to search results view
      navigate(`/search?q=${encodeURIComponent(searchQuery)}&path=${encodeURIComponent(currentPath)}`);
    } catch (error: any) {
      toast({
        title: "Search failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Browse Code</h1>
            <p className="text-muted-foreground">Explore your rotation-engine project</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-2">
              <Input
                placeholder="Search code (e.g., 'def entry_signal')"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchCode()}
              />
              <Button onClick={searchCode} disabled={loading}>
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* File Browser */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Folder className="h-5 w-5" />
                {currentPath || 'Root'}
              </CardTitle>
              {currentPath && (
                <Button variant="ghost" size="sm" onClick={goBack}>
                  <ChevronRight className="h-4 w-4 rotate-180 mr-1" />
                  Back
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : files.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No files found</div>
              ) : (
                <div className="space-y-1">
                  {files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                      onClick={() => handleFileClick(file)}
                    >
                      {file.type === 'directory' ? (
                        <Folder className="h-5 w-5 text-blue-500" />
                      ) : (
                        <FileCode2 className="h-5 w-5 text-green-500" />
                      )}
                      <span className="text-foreground font-medium">{file.name}</span>
                      {file.type === 'directory' && (
                        <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setCurrentPath('profiles')}>
            <CardHeader>
              <CardTitle className="text-lg">Strategy Profiles</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Browse your trading strategies</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setCurrentPath('filters')}>
            <CardHeader>
              <CardTitle className="text-lg">Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">View filter implementations</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
