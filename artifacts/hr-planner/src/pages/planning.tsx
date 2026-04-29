import { Layout } from "@/components/layout";
import { useParams, Link } from "wouter";
import { useGetMonthPlanning, getGetMonthPlanningQueryKey, useListEmployees, getListEmployeesQueryKey, useListShiftCodes, getListShiftCodesQueryKey, useGeneratePlanning, useConfirmPlanning, useUpdatePlanningEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, CheckCircle, Wand2, AlertCircle } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export default function Planning() {
  const params = useParams();
  const year = parseInt(params.year || new Date().getFullYear().toString(), 10);
  const month = parseInt(params.month || (new Date().getMonth() + 1).toString(), 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: planning, isLoading: isLoadingPlanning } = useGetMonthPlanning(year, month, {
    query: { queryKey: getGetMonthPlanningQueryKey(year, month) }
  });

  const { data: employees } = useListEmployees({
    query: { queryKey: getListEmployeesQueryKey() }
  });

  const { data: shiftCodes } = useListShiftCodes({
    query: { queryKey: getListShiftCodesQueryKey() }
  });

  const generatePlanning = useGeneratePlanning();
  const confirmPlanning = useConfirmPlanning();
  const updateEntry = useUpdatePlanningEntry();

  const handleGenerate = () => {
    generatePlanning.mutate({ year, month, data: { requestedDaysOff: [], overwriteExisting: true } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
        toast({ title: "Planning generated successfully" });
      }
    });
  };

  const handleConfirm = () => {
    confirmPlanning.mutate({ year, month }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
        toast({ title: "Planning confirmed successfully" });
      }
    });
  };

  const handleUpdateShift = (entryId: number, shiftCode: string) => {
    updateEntry.mutate({ id: entryId, data: { shiftCode } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
      }
    });
  };

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const date = new Date(year, month - 1, 1);
  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(date),
    end: endOfMonth(date)
  });

  return (
    <Layout>
      <div className="flex flex-col gap-6 h-full">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight">Planning</h1>
            <div className="flex items-center gap-2 bg-card border rounded-lg p-1">
              <Link href={`/planning/${prevYear}/${prevMonth}`}>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div className="font-medium text-sm w-32 text-center">
                {format(date, "MMMM yyyy")}
              </div>
              <Link href={`/planning/${nextYear}/${nextMonth}`}>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
            {planning && (
              <Badge variant={planning.status === "confirmed" ? "default" : "secondary"}>
                {planning.status}
              </Badge>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Collect Requests
            </Button>
            <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generatePlanning.isPending}>
              <Wand2 className="h-4 w-4 mr-2" />
              Generate
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={confirmPlanning.isPending || planning?.status === "confirmed"}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Confirm
            </Button>
          </div>
        </div>

        {planning?.violations && planning.violations.length > 0 && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg flex flex-col gap-2">
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle className="h-5 w-5" />
              Violations Detected ({planning.violations.length})
            </div>
            <ul className="list-disc list-inside text-sm pl-5 space-y-1">
              {planning.violations.slice(0, 3).map((v, i) => (
                <li key={i}>{format(new Date(v.date), "MMM d")}: {v.message}</li>
              ))}
              {planning.violations.length > 3 && (
                <li>...and {planning.violations.length - 3} more</li>
              )}
            </ul>
          </div>
        )}

        <div className="border rounded-xl bg-card overflow-hidden flex-1 flex flex-col">
          {isLoadingPlanning ? (
            <div className="p-8 space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !planning || !employees ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground p-8 text-center">
              No planning data available for this month.<br />Click Generate to create a draft.
            </div>
          ) : (
            <div className="overflow-auto flex-1 relative">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="text-xs uppercase bg-muted/50 sticky top-0 z-10 shadow-sm border-b">
                  <tr>
                    <th className="px-4 py-3 font-semibold sticky left-0 bg-muted/50 z-20 w-48 border-r shadow-[1px_0_0_0_var(--color-border)]">Employee</th>
                    {daysInMonth.map(day => {
                      const weekend = isWeekend(day);
                      return (
                        <th key={day.toISOString()} className={`px-2 py-2 text-center min-w-[40px] border-r ${weekend ? 'bg-muted/80' : ''}`}>
                          <div className="font-semibold text-muted-foreground">{format(day, "E")[0]}</div>
                          <div>{format(day, "d")}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 font-medium sticky left-0 bg-card z-10 border-r shadow-[1px_0_0_0_var(--color-border)] truncate">
                        {emp.name}
                      </td>
                      {daysInMonth.map(day => {
                        const dateStr = format(day, "yyyy-MM-dd");
                        const entry = planning.entries.find(e => e.employeeId === emp.id && e.date.startsWith(dateStr));
                        const weekend = isWeekend(day);
                        const hasViolation = planning.violations.some(v => v.date.startsWith(dateStr) && v.employeeId === emp.id);

                        return (
                          <td key={day.toISOString()} className={`p-1 border-r text-center relative ${weekend ? 'bg-muted/20' : ''} ${hasViolation ? 'bg-destructive/5' : ''}`}>
                            {entry && entry.shiftCode && !weekend ? (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className={`px-2 py-1 text-xs font-semibold rounded w-full border border-transparent hover:border-border transition-colors ${hasViolation ? 'text-destructive ring-1 ring-destructive' : 'bg-primary/10 text-primary'}`}>
                                    {entry.shiftCode}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-48 p-2" side="bottom">
                                  <div className="grid grid-cols-2 gap-1">
                                    {shiftCodes?.map(sc => (
                                      <Button 
                                        key={sc.code} 
                                        size="sm" 
                                        variant={sc.code === entry.shiftCode ? "default" : "outline"}
                                        onClick={() => handleUpdateShift(entry.id, sc.code)}
                                        className="text-xs"
                                      >
                                        {sc.code}
                                      </Button>
                                    ))}
                                    <Button 
                                      size="sm" 
                                      variant="outline" 
                                      className="text-destructive text-xs col-span-2"
                                      onClick={() => handleUpdateShift(entry.id, "")}
                                    >
                                      Clear
                                    </Button>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}