/**
 * Learning Center - Educational glossary and context
 */

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Search, BookOpen, Lightbulb } from 'lucide-react'
import { QUANT_GLOSSARY, searchGlossary, type GlossaryEntry } from '@/lib/quantGlossary'

export const LearningCenter = () => {
  const [searchQuery, setSearchQuery] = useState('')
  
  const displayedEntries = searchQuery 
    ? searchGlossary(searchQuery)
    : Object.values(QUANT_GLOSSARY)

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Learning Center</CardTitle>
        </div>
        <CardDescription>
          Quick reference for quantitative concepts
        </CardDescription>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col min-h-0 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search concepts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Glossary */}
        <ScrollArea className="flex-1">
          <div className="space-y-3 pr-4">
            {displayedEntries.length > 0 ? (
              displayedEntries.map((entry) => (
                <GlossaryCard key={entry.term} entry={entry} />
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No concepts found</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function GlossaryCard({ entry }: { entry: GlossaryEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card 
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <CardContent className="p-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-sm">{entry.term}</h4>
            <Badge variant="outline" className="text-xs shrink-0">
              {expanded ? 'Hide' : 'Learn'}
            </Badge>
          </div>
          
          <p className="text-sm text-muted-foreground leading-relaxed">
            {entry.definition}
          </p>

          {expanded && (
            <div className="space-y-3 pt-2 border-t animate-in slide-in-from-top-2">
              {entry.analogy && (
                <div className="flex gap-2">
                  <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-primary mb-1">Analogy</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {entry.analogy}
                    </p>
                  </div>
                </div>
              )}
              
              {entry.example && (
                <div className="p-2 rounded bg-accent/50">
                  <p className="text-xs font-medium mb-1">Example</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {entry.example}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
