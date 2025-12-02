/**
 * Onboarding Wizard - First-time user experience
 * Guides new users through QuantOS setup and features
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card } from '@/components/ui/card';
import { 
  Sparkles, 
  FolderOpen, 
  LayoutDashboard, 
  PlayCircle, 
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  X
} from 'lucide-react';
import { toast } from 'sonner';

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to QuantOS!',
    description: "Let's learn quantitative research by doing",
    icon: Sparkles,
  },
  {
    id: 'layout',
    title: 'Your Research IDE',
    description: 'Understanding the interface',
    icon: LayoutDashboard,
  },
  {
    id: 'workflow',
    title: 'Research Workflow',
    description: 'How the CIO helps you discover strategies',
    icon: PlayCircle,
  },
  {
    id: 'ready',
    title: "You're Ready!",
    description: 'Start your first research session',
    icon: CheckCircle2,
  },
];

export function OnboardingWizard({ open, onComplete, onSkip }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [projectConfigured, setProjectConfigured] = useState(false);

  const step = STEPS[currentStep];
  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    localStorage.setItem('quantos_onboarding_completed', 'true');
    toast.success('Welcome to QuantOS! Ready to start researching.');
    onComplete();
  };

  const handleSkipAll = () => {
    localStorage.setItem('quantos_onboarding_completed', 'true');
    onSkip();
  };

  const handleConfigureProject = async () => {
    try {
      if (!window.electron?.pickDirectory) {
        toast.error('Directory picker only available in desktop app');
        return;
      }
      
      const selectedPath = await window.electron.pickDirectory();
      if (selectedPath) {
        const result = await window.electron.setProjectDirectory?.(selectedPath);
        if (result?.success) {
          toast.success('Project directory configured!');
          setProjectConfigured(true);
        }
      }
    } catch (error: any) {
      console.error('Failed to set directory:', error);
      toast.error(error.message || 'Failed to configure directory');
    }
  };

  const renderStepContent = () => {
    switch (step.id) {
      case 'welcome':
        return (
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-2xl font-bold">Welcome to QuantOS</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                QuantOS is your visual research IDE for discovering profitable trading strategies. 
                You'll work alongside the CIO, an AI strategist who helps you explore market regimes
                and discover convexity-based strategies.
              </p>
            </div>

            <Card className="p-6 bg-primary/5 border-primary/20">
              <div className="space-y-3">
                <h4 className="font-semibold text-primary">What You'll Learn:</h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>How to classify market regimes (Low Vol, High Vol, Crash, Melt Up)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>How to discover strategies that work in specific regimes</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>How to backtest and validate your discoveries</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>How to build a regime-aware portfolio</span>
                  </li>
                </ul>
              </div>
            </Card>

            {!projectConfigured && (
              <Card className="p-4 border-amber-500/50 bg-amber-500/10">
                <div className="flex items-start gap-3">
                  <FolderOpen className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <p className="text-sm font-medium">Optional: Configure Project Directory</p>
                    <p className="text-xs text-muted-foreground">
                      Point to your rotation-engine directory for code analysis features
                    </p>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={handleConfigureProject}
                      className="mt-2"
                    >
                      Browse for Directory
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        );

      case 'layout':
        return (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                <LayoutDashboard className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold">Your Research IDE</h3>
              <p className="text-sm text-muted-foreground">
                QuantOS uses a two-panel layout optimized for ADHD-friendly research
              </p>
            </div>

            <div className="grid gap-4">
              <Card className="p-4 border-l-4 border-l-blue-500">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Left Panel: Chat with the CIO</h4>
                  <p className="text-xs text-muted-foreground">
                    This is your primary interface. All work happens through natural conversation. 
                    Just tell the CIO what you want to explore, and it handles the analysis.
                  </p>
                  <div className="text-xs bg-muted/50 rounded p-2 font-mono mt-2">
                    Example: "Classify 2023 regimes and find strategies for Low Vol periods"
                  </div>
                </div>
              </Card>

              <Card className="p-4 border-l-4 border-l-emerald-500">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Right Panel (Top): Live Visualizations</h4>
                  <p className="text-xs text-muted-foreground">
                    As the CIO works, visualizations automatically appear here: regime timelines,
                    strategy matrices, equity curves, and more. Watch your research unfold visually.
                  </p>
                </div>
              </Card>

              <Card className="p-4 border-l-4 border-l-violet-500">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Right Panel (Bottom): Research Roadmap</h4>
                  <p className="text-xs text-muted-foreground">
                    Your research progress tracker. Shows current stage, completed work, and next steps. 
                    Includes Learning Center and Key Findings tabs for educational support.
                  </p>
                </div>
              </Card>
            </div>

            <Card className="p-4 bg-primary/5 border-primary/20">
              <p className="text-xs text-muted-foreground">
                <strong className="text-primary">Pro Tip:</strong> You're the Research Director. The CIO handles strategy, the CTO handles execution.
                You don't do the work—you direct it through conversation. Just observe and guide.
              </p>
            </Card>
          </div>
        );

      case 'workflow':
        return (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                <PlayCircle className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold">Research Workflow</h3>
              <p className="text-sm text-muted-foreground">
                The discovery cycle: Regime → Strategy → Backtest → Tune → Loop
              </p>
            </div>

            <div className="space-y-3">
              {[
                {
                  step: 1,
                  title: 'Regime Mapping',
                  desc: 'Classify market periods by volatility and behavior',
                  example: '"Classify regimes for 2023"',
                },
                {
                  step: 2,
                  title: 'Strategy Discovery',
                  desc: 'Find convexity profiles that work in specific regimes',
                  example: '"Find strategies for Low Vol regime"',
                },
                {
                  step: 3,
                  title: 'Backtesting',
                  desc: 'Test strategies on historical data',
                  example: '"Backtest Short Put strategy in Low Vol"',
                },
                {
                  step: 4,
                  title: 'Tuning & Validation',
                  desc: 'Optimize parameters and verify edge',
                  example: '"Optimize delta selection for Short Puts"',
                },
                {
                  step: 5,
                  title: 'Loop & Refine',
                  desc: 'Cycle back to discover more or improve existing strategies',
                  example: '"What other strategies work in High Vol?"',
                },
              ].map((item, idx) => (
                <Card key={idx} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">{item.step}</span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <h4 className="font-semibold text-sm">{item.title}</h4>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                      <div className="text-xs bg-muted/50 rounded px-2 py-1 font-mono mt-2">
                        {item.example}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Card className="p-4 bg-primary/5 border-primary/20">
              <p className="text-xs text-muted-foreground">
                <strong className="text-primary">Key Insight:</strong> This isn't linear—you can jump to any stage 
                based on what you discover. The CIO adapts to your research direction.
              </p>
            </Card>
          </div>
        );

      case 'ready':
        return (
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 mx-auto bg-emerald-500/10 rounded-full flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <h3 className="text-2xl font-bold">You're Ready to Start!</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Time to begin your quantitative research journey. Here are some prompts to get started:
              </p>
            </div>

            <div className="space-y-3">
              <Card className="p-4 hover:bg-accent/50 cursor-pointer transition-colors border-l-4 border-l-blue-500">
                <h4 className="font-semibold text-sm mb-1">For Beginners:</h4>
                <p className="text-xs text-muted-foreground font-mono">
                  "Explain market regimes and show me examples from 2023"
                </p>
              </Card>

              <Card className="p-4 hover:bg-accent/50 cursor-pointer transition-colors border-l-4 border-l-emerald-500">
                <h4 className="font-semibold text-sm mb-1">Ready to Explore:</h4>
                <p className="text-xs text-muted-foreground font-mono">
                  "Classify 2023 regimes and find one simple strategy for Low Vol"
                </p>
              </Card>

              <Card className="p-4 hover:bg-accent/50 cursor-pointer transition-colors border-l-4 border-l-violet-500">
                <h4 className="font-semibold text-sm mb-1">Experienced Researchers:</h4>
                <p className="text-xs text-muted-foreground font-mono">
                  "Analyze convexity profiles across all 2022-2023 regimes"
                </p>
              </Card>
            </div>

            <Card className="p-6 bg-primary/5 border-primary/20">
              <div className="space-y-3 text-center">
                <h4 className="font-semibold text-primary">Remember:</h4>
                <ul className="space-y-2 text-sm text-muted-foreground text-left max-w-md mx-auto">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>You direct strategy, the AI team delivers</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Visualizations update automatically</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Use Learning Center tab for concept explanations</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Press ? for help or open Helper chat anytime</span>
                  </li>
                </ul>
              </div>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg flex items-center gap-2">
                <step.icon className="h-5 w-5 text-primary" />
                {step.title}
              </DialogTitle>
              <DialogDescription className="text-sm">
                {step.description}
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkipAll}
              className="text-xs"
            >
              <X className="h-3 w-3 mr-1" />
              Skip Tutorial
            </Button>
          </div>
        </DialogHeader>

        {/* Progress */}
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Step {currentStep + 1} of {STEPS.length}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
        </div>

        {/* Content */}
        <div className="py-4">
          {renderStepContent()}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={currentStep === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          <div className="flex gap-1">
            {STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`w-2 h-2 rounded-full transition-colors ${
                  idx === currentStep
                    ? 'bg-primary'
                    : idx < currentStep
                    ? 'bg-primary/50'
                    : 'bg-muted'
                }`}
              />
            ))}
          </div>

          <Button onClick={handleNext}>
            {currentStep === STEPS.length - 1 ? (
              <>
                Start Researching
                <CheckCircle2 className="h-4 w-4 ml-1" />
              </>
            ) : (
              <>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
