import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ChatProvider } from "@/contexts/ChatContext";
import { useEffect, useState } from 'react';
import Index from "./pages/Index";
import Settings from "./pages/Settings";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import { FirstLaunchModal } from './components/settings/FirstLaunchModal';
import { isRunningInElectron } from './lib/electronClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CommandPalette } from '@/components/ui/CommandPalette';

const queryClient = new QueryClient();

const App = () => {
  const [showFirstLaunch, setShowFirstLaunch] = useState(false);
  const [isCheckingDirectory, setIsCheckingDirectory] = useState(true);

  useEffect(() => {
    // Check if project directory is configured on first load (Electron only)
    const checkProjectDirectory = async () => {
      if (!isRunningInElectron() || !window.electron?.getProjectDirectory) {
        setIsCheckingDirectory(false);
        return;
      }

      try {
        const projectDir = await window.electron.getProjectDirectory();
        if (!projectDir) {
          setShowFirstLaunch(true);
        }
      } catch (error) {
        console.error('Error checking project directory:', error);
      } finally {
        setIsCheckingDirectory(false);
      }
    };

    checkProjectDirectory();
  }, []);

  const handleFirstLaunchComplete = () => {
    setShowFirstLaunch(false);
  };

  if (isCheckingDirectory) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="flex items-center justify-center h-screen">
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
              <p className="text-muted-foreground">Loading...</p>
            </div>
          </div>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ChatProvider>
            <Toaster />
            <Sonner />
            <HashRouter>
              <CommandPalette />
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/dashboard" element={<Dashboard />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </HashRouter>

            {showFirstLaunch && (
              <FirstLaunchModal
                open={showFirstLaunch}
                onComplete={handleFirstLaunchComplete}
              />
            )}
          </ChatProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
