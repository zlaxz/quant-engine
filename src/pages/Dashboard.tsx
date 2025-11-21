import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  FileCode2, 
  Play, 
  TrendingUp, 
  Brain, 
  Shield, 
  Search,
  GitBranch,
  FileText
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const navigate = useNavigate();

  const quickActions = [
    {
      icon: FileCode2,
      title: "Browse Strategies",
      description: "Explore your rotation-engine code",
      action: () => navigate('/browse'),
      color: "text-blue-500"
    },
    {
      icon: Play,
      title: "Run Backtest",
      description: "Test a strategy with visual form",
      action: () => navigate('/backtest'),
      color: "text-green-500"
    },
    {
      icon: TrendingUp,
      title: "View Results",
      description: "See all your backtest runs",
      action: () => navigate('/results'),
      color: "text-purple-500"
    },
    {
      icon: Brain,
      title: "Analyze Patterns",
      description: "Find insights across runs",
      action: () => navigate('/analyze'),
      color: "text-orange-500"
    },
    {
      icon: Shield,
      title: "Risk Review",
      description: "Check downside risks",
      action: () => navigate('/risk'),
      color: "text-red-500"
    },
    {
      icon: Search,
      title: "Code Audit",
      description: "Red team your strategy code",
      action: () => navigate('/audit'),
      color: "text-yellow-500"
    }
  ];

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-foreground mb-2">Quant Research OS</h1>
          <p className="text-muted-foreground">Visual workspace for your rotation-engine project</p>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action) => (
            <Card 
              key={action.title}
              className="hover:shadow-lg transition-shadow cursor-pointer border-border"
              onClick={action.action}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-muted ${action.color}`}>
                    <action.icon className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-lg">{action.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{action.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Getting Started */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Getting Started
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">1</div>
              <div>
                <p className="font-medium text-foreground">Browse your strategies</p>
                <p className="text-sm text-muted-foreground">Click "Browse Strategies" to explore your rotation-engine code</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">2</div>
              <div>
                <p className="font-medium text-foreground">Run a backtest</p>
                <p className="text-sm text-muted-foreground">Use the visual form to test a strategy - no commands needed</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">3</div>
              <div>
                <p className="font-medium text-foreground">Analyze results</p>
                <p className="text-sm text-muted-foreground">View metrics, compare runs, get AI insights - all visual</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pro Tip */}
        <Card className="border-muted">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Pro Tip
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Power users: Slash commands still work in chat for quick access (type <code className="bg-muted px-1 rounded">/help</code> to see all)
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
