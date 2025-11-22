import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProjectDirectorySettings } from '@/components/settings/ProjectDirectorySettings';

export default function Settings() {
  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground mt-2">
            Configure your Quant Chat Workbench preferences
          </p>
        </div>

        <Tabs defaultValue="general" className="w-full">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="project">Project Directory</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
            <div className="text-muted-foreground">
              General settings coming soon...
            </div>
          </TabsContent>

          <TabsContent value="project" className="space-y-4">
            <ProjectDirectorySettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
