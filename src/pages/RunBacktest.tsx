import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Play, ArrowLeft, Loader2 } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';

export default function RunBacktest() {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [capital, setCapital] = useState('100000');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      const { data, error } = await supabase
        .from('strategies')
        .select('*')
        .eq('active', true)
        .order('name');

      if (error) throw error;
      setStrategies(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading strategies",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const runBacktest = async () => {
    if (!selectedStrategy || !startDate || !endDate) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('backtest-run', {
        body: {
          strategy_key: selectedStrategy,
          params: {
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
            capital: parseFloat(capital)
          }
        }
      });

      if (error) throw error;

      toast({
        title: "Backtest started",
        description: "Your backtest is running..."
      });

      navigate('/results');
    } catch (error: any) {
      toast({
        title: "Backtest failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Run Backtest</h1>
            <p className="text-muted-foreground">Test a strategy with visual form</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>

        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle>Backtest Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Strategy Selection */}
            <div className="space-y-2">
              <Label>Strategy</Label>
              <Select value={selectedStrategy} onValueChange={setSelectedStrategy}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a strategy..." />
                </SelectTrigger>
                <SelectContent>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={s.key}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left">
                      {startDate ? format(startDate, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={startDate} onSelect={setStartDate} />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>End Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left">
                      {endDate ? format(endDate, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={endDate} onSelect={setEndDate} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Capital */}
            <div className="space-y-2">
              <Label>Initial Capital ($)</Label>
              <Input
                type="number"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                placeholder="100000"
              />
            </div>

            {/* Run Button */}
            <Button 
              className="w-full" 
              size="lg"
              onClick={runBacktest}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run Backtest
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Quick Presets */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Quick Presets</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              setStartDate(new Date('2024-01-01'));
              setEndDate(new Date('2024-12-31'));
            }}>
              2024 Full Year
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              setStartDate(new Date('2024-07-01'));
              setEndDate(new Date('2024-12-31'));
            }}>
              2024 H2
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              setStartDate(new Date('2023-01-01'));
              setEndDate(new Date('2024-12-31'));
            }}>
              2023-2024
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
