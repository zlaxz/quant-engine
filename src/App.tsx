import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ResearchDisplayProvider } from "@/contexts/ResearchDisplayContext";
import { VisualizationProvider } from "@/contexts/VisualizationContext";
import { useEffect, useState, lazy, Suspense } from 'react';
import Launchpad from "./pages/Launchpad";
import Settings from "./pages/Settings";
import Dashboard from "./pages/Dashboard";
import TradingTerminal from "./pages/TradingTerminal";
import Strategies from "./pages/Strategies";
import Observatory from "./pages/Observatory";
import NotFound from "./pages/NotFound";
import { FirstLaunchModal } from './components/settings/FirstLaunchModal';
import { isRunningInElectron } from './lib/electronClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { JarvisEventHandler } from '@/components/JarvisEventHandler';

// Lazy load popout pages for code splitting
const PopoutVisualization = lazy(() => import('./pages/PopoutVisualization'));

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
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <ResearchDisplayProvider>
              <VisualizationProvider>
                <JarvisEventHandler />
                <Toaster />
                <Sonner />
                <HashRouter>
                  <CommandPalette />
                  <Routes>
                    <Route path="/" element={<Launchpad />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/terminal" element={<TradingTerminal />} />
                    <Route path="/strategies" element={<Strategies />} />
                    <Route path="/observatory" element={<Observatory />} />
                    <Route
                      path="/popout/:id"
                      element={
                        <Suspense fallback={<div className="h-screen flex items-center justify-center">Loading...</div>}>
                          <PopoutVisualization />
                        </Suspense>
                      }
                    />
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
              </VisualizationProvider>
            </ResearchDisplayProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
