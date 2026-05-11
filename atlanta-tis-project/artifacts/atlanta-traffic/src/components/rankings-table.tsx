import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InefficiencyRanking } from "@workspace/api-client-react";
import { Search, ArrowUpDown } from "lucide-react";

interface RankingsTableProps {
  data: InefficiencyRanking[];
  onRowClick: (id: string) => void;
}

export function RankingsTable({ data, onRowClick }: RankingsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "inefficiencyScore", desc: true }
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<InefficiencyRanking>[]>(() => [
    {
      id: "rank",
      header: "#",
      cell: ({ row }) => <span className="text-muted-foreground text-xs font-medium">{row.index + 1}</span>,
      size: 40,
    },
    {
      accessorKey: "name",
      header: "Intersection",
      cell: ({ row }) => <span className="font-medium text-sm">{row.original.name}</span>,
    },
    {
      accessorKey: "zone",
      header: "Zone",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.zone}</span>,
    },
    {
      accessorKey: "severity",
      header: "Severity",
      cell: ({ row }) => {
        const severity = row.original.severity;
        const colorMap: Record<string, string> = {
          low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800",
          moderate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
          high: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800",
          critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
        };
        return <Badge variant="outline" className={`px-2 py-0 h-5 text-[11px] font-medium ${colorMap[severity] || ''} capitalize`}>{severity}</Badge>;
      },
    },
    {
      accessorKey: "inefficiencyScore",
      header: "Score",
      cell: ({ row }) => <span className="font-bold">{row.original.inefficiencyScore}</span>,
    },
    {
      accessorKey: "avgDelaySeconds",
      header: "Avg Delay",
      cell: ({ row }) => <span className="text-sm">{row.original.avgDelaySeconds}s</span>,
    },
    {
      accessorKey: "turningVolume",
      header: "Turn Vol.",
      cell: ({ row }) => <span className="text-sm">{row.original.turningVolume.toLocaleString()}</span>,
    },
    {
      accessorKey: "worstMovement",
      header: "Worst Mvmt.",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.worstMovement}</span>,
    },
  ], []);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search intersections, zones..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead 
                    key={header.id} 
                    onClick={header.column.getToggleSortingHandler()} 
                    className={`cursor-pointer select-none text-xs font-semibold whitespace-nowrap h-9 ${header.column.id === 'rank' ? 'w-10' : ''}`}
                  >
                    <div className="flex items-center gap-1.5">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow 
                  key={row.id}
                  onClick={() => onRowClick(row.original.id)}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No matching intersections found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="p-4 border-t mt-auto flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{" "}
          {Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, table.getFilteredRowModel().rows.length)}{" "}
          of {table.getFilteredRowModel().rows.length}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
        </div>
      </div>
    </div>
  );
}
