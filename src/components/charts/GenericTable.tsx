/**
 * GenericTable - Universal Table Component
 *
 * Flexible table with sorting, filtering, pagination, and export.
 * Uses shadcn/ui table components with professional styling.
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { TableData, TableColumn, TableRow as TableRowData } from './types';

interface GenericTableProps {
  data: TableData;
}

export function GenericTable({ data }: GenericTableProps) {
  const config = data.config || {};
  const [sortColumn, setSortColumn] = useState<string | null>(
    config.defaultSort?.column || null
  );
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(
    config.defaultSort?.direction || 'asc'
  );
  const [filterText, setFilterText] = useState('');
  const [currentPage, setCurrentPage] = useState(0);

  const pageSize = config.pageSize || 10;

  // Filtering
  const filteredRows = useMemo(() => {
    if (!config.filterable || !filterText) return data.rows;

    const searchLower = filterText.toLowerCase();
    return data.rows.filter(row =>
      data.columns.some(col => {
        if (!col.filterable) return false;
        const value = row[col.key];
        return String(value).toLowerCase().includes(searchLower);
      })
    );
  }, [data.rows, data.columns, filterText, config.filterable]);

  // Sorting
  const sortedRows = useMemo(() => {
    if (!config.sortable || !sortColumn) return filteredRows;

    const column = data.columns.find(c => c.key === sortColumn);
    if (!column?.sortable) return filteredRows;

    return [...filteredRows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      // Handle nulls
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // Type-aware comparison
      let comparison = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredRows, sortColumn, sortDirection, data.columns, config.sortable]);

  // Pagination
  const totalPages = Math.ceil(sortedRows.length / pageSize);
  const paginatedRows = config.pageSize
    ? sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
    : sortedRows;

  const handleSort = (column: TableColumn) => {
    if (!config.sortable || !column.sortable) return;

    if (sortColumn === column.key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column.key);
      setSortDirection('asc');
    }
  };

  const handleExport = () => {
    const csv = generateCSV(data.columns, sortedRows);
    downloadCSV(csv, `${data.title.replace(/\s+/g, '_')}.csv`);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{data.title}</CardTitle>
            {data.description && <CardDescription>{data.description}</CardDescription>}
          </div>
          <div className="flex items-center gap-2">
            {config.filterable && (
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  className="pl-8 w-[200px]"
                />
              </div>
            )}
            {config.exportable && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {data.columns.map(column => (
                  <TableHead
                    key={column.key}
                    className={`${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''}`}
                    style={{ width: column.width }}
                  >
                    {config.sortable && column.sortable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 font-medium hover:bg-transparent"
                        onClick={() => handleSort(column)}
                      >
                        {column.label}
                        {sortColumn === column.key ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="ml-2 h-4 w-4" />
                          ) : (
                            <ArrowDown className="ml-2 h-4 w-4" />
                          )
                        ) : (
                          <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
                        )}
                      </Button>
                    ) : (
                      column.label
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={data.columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No results found
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows.map((row, i) => (
                  <TableRow key={i} className={config.striped && i % 2 === 1 ? 'bg-muted/50' : ''}>
                    {data.columns.map(column => (
                      <TableCell
                        key={column.key}
                        className={`${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''} ${
                          config.compact ? 'py-2' : ''
                        }`}
                      >
                        {renderCell(row, column)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {config.pageSize && totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Showing {currentPage * pageSize + 1} to{' '}
              {Math.min((currentPage + 1) * pageSize, sortedRows.length)} of{' '}
              {sortedRows.length} results
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <div className="text-sm">
                Page {currentPage + 1} of {totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage === totalPages - 1}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Cell Rendering
// ============================================================================

function renderCell(row: TableRowData, column: TableColumn) {
  const value = row[column.key];

  // Custom render function
  if (column.render) {
    return column.render(value, row);
  }

  // Null/undefined handling
  if (value == null) {
    return <span className="text-muted-foreground">-</span>;
  }

  // Type-specific rendering
  switch (column.type) {
    case 'boolean':
      return (
        <Badge variant={value ? 'default' : 'secondary'}>
          {value ? 'Yes' : 'No'}
        </Badge>
      );

    case 'badge':
      return <Badge>{String(value)}</Badge>;

    case 'date':
      return formatDate(value);

    case 'percent':
      return formatPercent(value as number);

    case 'currency':
      return formatCurrency(value as number);

    case 'number':
      return formatNumber(value as number, column.format);

    case 'string':
    default:
      return String(value);
  }
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatDate(value: unknown): string {
  try {
    const date = new Date(value as string | number | Date);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return String(value);
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function formatNumber(value: number, format?: string): string {
  if (format) {
    // Could implement custom format parsing here
    return value.toFixed(2);
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// ============================================================================
// Export Helpers
// ============================================================================

function generateCSV(columns: TableColumn[], rows: TableRowData[]): string {
  const headers = columns.map(c => c.label).join(',');
  const dataRows = rows.map(row =>
    columns.map(col => {
      const value = row[col.key];
      if (value == null) return '';
      // Escape quotes and wrap in quotes if contains comma
      const str = String(value);
      return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(',')
  );

  return [headers, ...dataRows].join('\n');
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
