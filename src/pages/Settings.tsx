import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProjectDirectorySettings } from '@/components/settings/ProjectDirectorySettings';
import { APIKeySettings } from '@/components/settings/APIKeySettings';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Settings() {
  const navigate = useNavigate();

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
            title="Back to Chat"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground mt-2">
              Configure your Quant Chat Workbench preferences
            </p>
          </div>
        </div>

        <Tabs defaultValue="general" className="w-full">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="project">Project Directory</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
            <div className="text-muted-foreground">
              General settings coming soon...
            </div>
          </TabsContent>

          <TabsContent value="project" className="space-y-4">
            <ProjectDirectorySettings />
          </TabsContent>

          <TabsContent value="api-keys" className="space-y-4">
            <APIKeySettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
