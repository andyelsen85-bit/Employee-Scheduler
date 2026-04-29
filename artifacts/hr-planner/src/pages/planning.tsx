import { Layout } from "@/components/layout";
import { useParams, Link } from "wouter";
import { useGetMonthPlanning, getGetMonthPlanningQueryKey, useListEmployees, getListEmployeesQueryKey, useListShiftCodes, getListShiftCodesQueryKey, useGeneratePlanning, useGenerateEmployeePlanning, useConfirmPlanning, useUpdatePlanningEntry, useGetMonthlyConfig, getGetMonthlyConfigQueryKey, useListOffices, getListOfficesQueryKey, useListDepartments, getListDepartmentsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, CheckCircle, Wand2, AlertCircle, Trash2, Lock, RefreshCw } from "lucide-react";
import { useState, Fragment } from "react";
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

  const { data: monthlyConfig } = useGetMonthlyConfig(year, month, {
    query: { queryKey: getGetMonthlyConfigQueryKey(year, month) }
  });

  const { data: offices } = useListOffices({
    query: { queryKey: getListOfficesQueryKey() }
  });
  const { data: departments } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() }
  });

  // Group employees: SPOC → Management → per dept (sorted by order) → ungrouped
  type EmpRow = NonNullable<typeof employees>[number];
  const buildGroups = (emps: EmpRow[], depts: NonNullable<typeof departments>) => {
    const spoc = emps.filter(e => e.isSpoc);
    const management = emps.filter(e => !e.isSpoc && e.isManagement);
    const sortedDepts = [...depts].sort((a, b) => a.order - b.order);
    const deptGroups = sortedDepts.map(d => ({
      label: d.name,
      emps: emps.filter(e => !e.isSpoc && !e.isManagement && (e as Record<string, unknown>).departmentId === d.id),
    })).filter(g => g.emps.length > 0);
    const assignedEmpIds = new Set([
      ...spoc.map(e => e.id),
      ...management.map(e => e.id),
      ...deptGroups.flatMap(g => g.emps.map(e => e.id)),
    ]);
    const ungrouped = emps.filter(e => !assignedEmpIds.has(e.id));
    const groups: { label: string | null; emps: EmpRow[] }[] = [];
    if (spoc.length) groups.push({ label: "SPOC", emps: spoc });
    if (management.length) groups.push({ label: "Management", emps: management });
    for (const g of deptGroups) groups.push(g);
    if (ungrouped.length) groups.push({ label: null, emps: ungrouped });
    return groups;
  };

  const employeeGroups = employees && departments ? buildGroups(employees, departments) : null;

  // Shift-type → inline color style
  const SHIFT_TYPE_STYLE: Record<string, { bg: string; text: string; border: string }> = {
    onsite:   { bg: "rgba(59,130,246,0.12)",  text: "#1d4ed8", border: "rgba(59,130,246,0.25)" },
    homework: { bg: "rgba(34,197,94,0.12)",   text: "#15803d", border: "rgba(34,197,94,0.25)" },
    cowork:   { bg: "rgba(245,158,11,0.12)",  text: "#b45309", border: "rgba(245,158,11,0.25)" },
    holiday:  { bg: "rgba(239,68,68,0.12)",   text: "#b91c1c", border: "rgba(239,68,68,0.25)" },
    jl:       { bg: "rgba(168,85,247,0.12)",  text: "#7e22ce", border: "rgba(168,85,247,0.25)" },
  };

  const shiftTypeMap = new Map<string, string>(
    (shiftCodes ?? []).map(sc => [sc.code, sc.type])
  );

  // Desk-code → office color map
  const OFFICE_PALETTE = [
    { bg: "#dbeafe", text: "#1d4ed8", border: "#bfdbfe" },
    { bg: "#dcfce7", text: "#15803d", border: "#bbf7d0" },
    { bg: "#f3e8ff", text: "#7e22ce", border: "#e9d5ff" },
    { bg: "#fed7aa", text: "#c2410c", border: "#fcd34d" },
    { bg: "#fce7f3", text: "#be185d", border: "#fbcfe8" },
    { bg: "#e0f2fe", text: "#0369a1", border: "#bae6fd" },
    { bg: "#fef9c3", text: "#a16207", border: "#fef08a" },
    { bg: "#ccfbf1", text: "#0f766e", border: "#99f6e4" },
  ];
  const deskColorMap = new Map<string, { bg: string; text: string; border: string }>();
  const allDeskCodes: { code: string; officeName: string }[] = [];
  if (offices) {
    offices.forEach((office, idx) => {
      const color = OFFICE_PALETTE[idx % OFFICE_PALETTE.length];
      (office.deskCodes ?? []).forEach((code) => {
        deskColorMap.set(code, color);
        allDeskCodes.push({ code, officeName: office.name });
      });
    });
  }

  // Desk clash detection: date → deskCode → [employeeIds]
  const deskClashes = new Map<string, Set<number>>();
  if (planning) {
    const deskByDate = new Map<string, Map<string, number[]>>();
    for (const e of planning.entries) {
      if (!e.deskCode) continue;
      const key = e.date;
      if (!deskByDate.has(key)) deskByDate.set(key, new Map());
      const dm = deskByDate.get(key)!;
      if (!dm.has(e.deskCode)) dm.set(e.deskCode, []);
      dm.get(e.deskCode)!.push(e.employeeId);
    }
    for (const [date, dm] of deskByDate.entries()) {
      for (const [, empIds] of dm.entries()) {
        if (empIds.length > 1) {
          if (!deskClashes.has(date)) deskClashes.set(date, new Set());
          empIds.forEach(id => deskClashes.get(date)!.add(id));
        }
      }
    }
  }

  const generatePlanning = useGeneratePlanning();
  const confirmPlanning = useConfirmPlanning();
  const updateEntry = useUpdatePlanningEntry();
  const generateEmployeePlanning = useGenerateEmployeePlanning();
  const [isClearing, setIsClearing] = useState(false);
  const [regeneratingEmployeeId, setRegeneratingEmployeeId] = useState<number | null>(null);

  const handleGenerate = () => {
    generatePlanning.mutate({ year, month, data: { requestedDaysOff: [] } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
        toast({ title: "Planning generated (locked entries preserved)" });
      }
    });
  };

  const handleForceRegenerate = async () => {
    if (!confirm("This will clear ALL entries (including locked/manual overrides) and regenerate from scratch. Continue?")) return;
    setIsClearing(true);
    try {
      const res = await fetch(`/api/planning/${year}/${month}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear");
      queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
    } catch {
      toast({ title: "Failed to clear planning", variant: "destructive" });
      setIsClearing(false);
      return;
    }
    setIsClearing(false);
    generatePlanning.mutate({ year, month, data: { requestedDaysOff: [] } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
        toast({ title: "Planning fully regenerated" });
      }
    });
  };

  const handleRegenerateEmployee = (employeeId: number) => {
    setRegeneratingEmployeeId(employeeId);
    generateEmployeePlanning.mutate(
      { year, month, employeeId, data: { requestedDaysOff: [] } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
          const emp = employees?.find((e) => e.id === employeeId);
          toast({ title: `${emp?.name ?? "Employee"} planning regenerated` });
        },
        onError: () => {
          toast({ title: "Failed to regenerate employee planning", variant: "destructive" });
        },
        onSettled: () => {
          setRegeneratingEmployeeId(null);
        },
      }
    );
  };

  const handleConfirm = () => {
    confirmPlanning.mutate({ year, month }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
        toast({ title: "Planning confirmed successfully" });
      }
    });
  };

  const handleClear = async () => {
    if (!confirm("Clear all planning entries for this month? This cannot be undone.")) return;
    setIsClearing(true);
    try {
      const res = await fetch(`/api/planning/${year}/${month}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear planning");
      queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
      toast({ title: "Planning cleared" });
    } catch {
      toast({ title: "Error clearing planning", variant: "destructive" });
    } finally {
      setIsClearing(false);
    }
  };

  const handleUpdateShift = (entryId: number, shiftCode: string) => {
    updateEntry.mutate({ id: entryId, data: { shiftCode: shiftCode || null } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
      }
    });
  };

  const handleUpdateDesk = (entryId: number, deskCode: string | null) => {
    updateEntry.mutate({ id: entryId, data: { deskCode: deskCode || null } }, {
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

  const shiftHoursMap = new Map<string, number>(
    (shiftCodes ?? []).map(sc => [sc.code, sc.hours])
  );

  const officialHours = monthlyConfig?.contractualHours ?? null;

  function getEmployeePlannedHours(empId: number): number {
    if (!planning) return 0;
    return planning.entries
      .filter(e => e.employeeId === empId && e.shiftCode)
      .reduce((sum, e) => sum + (shiftHoursMap.get(e.shiftCode!) ?? 0), 0);
  }

  const totalPlannedHours = employees
    ? employees.reduce((sum, emp) => sum + getEmployeePlannedHours(emp.id), 0)
    : 0;

  const lockedCount = planning ? planning.entries.filter(e => e.isLocked).length : 0;

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
            {lockedCount > 0 && (
              <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300 bg-amber-50">
                <Lock className="h-3 w-3" />
                {lockedCount} locked
              </Badge>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Collect Requests
            </Button>
            <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generatePlanning.isPending || isClearing}>
              <Wand2 className="h-4 w-4 mr-2" />
              Generate
            </Button>
            <Button variant="outline" size="sm" onClick={handleForceRegenerate} disabled={generatePlanning.isPending || isClearing} className="text-amber-700 border-amber-400 hover:bg-amber-50">
              <Wand2 className="h-4 w-4 mr-2" />
              Force Regenerate
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={confirmPlanning.isPending || planning?.status === "confirmed"}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Confirm
            </Button>
            {planning && (
              <Button variant="outline" size="sm" onClick={handleClear} disabled={isClearing} className="text-destructive border-destructive/40 hover:bg-destructive/10">
                <Trash2 className="h-4 w-4 mr-2" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {planning && employees && (
          <div className="flex flex-wrap gap-3">
            {employees.map(emp => {
              const planned = getEmployeePlannedHours(emp.id);
              const official = officialHours !== null
                ? Math.round(officialHours * ((emp.contractPercent ?? 100) / 100) * 10) / 10
                : null;
              const diff = official !== null ? planned - official : null;
              const over = diff !== null && diff > 0;
              const under = diff !== null && diff < 0;
              return (
                <div key={emp.id} className="flex items-center gap-2 bg-card border rounded-lg px-4 py-2 text-sm">
                  <span className="font-medium text-muted-foreground truncate max-w-[120px]">{emp.name}</span>
                  <span className="font-bold">{planned.toFixed(1)} h</span>
                  {official !== null && (
                    <>
                      <span className="text-muted-foreground">/ {official} h</span>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${over ? 'bg-amber-100 text-amber-700' : under ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                        {diff !== null && diff >= 0 ? `+${diff.toFixed(1)}` : diff?.toFixed(1)} h
                      </span>
                    </>
                  )}
                </div>
              );
            })}
            {employees.length > 1 && (
              <div className="flex items-center gap-2 bg-muted/50 border rounded-lg px-4 py-2 text-sm">
                <span className="font-medium text-muted-foreground">Total</span>
                <span className="font-bold">{totalPlannedHours.toFixed(1)} h</span>
                {officialHours !== null && (
                  <span className="text-muted-foreground">
                    / {employees.reduce((sum, emp) =>
                      sum + Math.round(officialHours * ((emp.contractPercent ?? 100) / 100) * 10) / 10, 0
                    ).toFixed(1)} h
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {planning?.violations && planning.violations.length > 0 && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg flex flex-col gap-2">
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle className="h-5 w-5" />
              Violations Detected ({planning.violations.length})
            </div>
            <ul className="list-disc list-inside text-sm pl-5 space-y-1">
              {planning.violations.slice(0, 5).map((v, i) => (
                <li key={i}>{v.date.length === 10 ? format(new Date(v.date), "MMM d") : v.date}: {v.message}</li>
              ))}
              {planning.violations.length > 5 && (
                <li>...and {planning.violations.length - 5} more</li>
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
                    <th className="px-3 py-2 text-center min-w-[90px] sticky right-0 bg-muted/50 z-20 border-l shadow-[-1px_0_0_0_var(--color-border)]">
                      <div className="font-semibold">Planned</div>
                      <div className="text-muted-foreground font-normal text-[10px]">/ Target · Diff</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(employeeGroups ?? [{ label: null, emps: employees ?? [] }]).map((group, gi) => (
                    <Fragment key={`group-frag-${gi}`}>
                      {group.label !== null && (
                        <tr className="border-b bg-muted/40">
                          <td
                            colSpan={daysInMonth.length + 2}
                            className="px-4 py-1 text-xs font-bold uppercase tracking-widest text-muted-foreground"
                          >
                            {group.label}
                          </td>
                        </tr>
                      )}
                      {group.emps.map(emp => {
                    const planned = getEmployeePlannedHours(emp.id);
                    const empOfficialHours = officialHours !== null
                      ? Math.round(officialHours * ((emp.contractPercent ?? 100) / 100) * 10) / 10
                      : null;
                    const diff = empOfficialHours !== null ? planned - empOfficialHours : null;
                    const over = diff !== null && diff > 0;
                    const under = diff !== null && diff < 0;
                    return (
                      <tr key={emp.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-2 py-2 font-medium sticky left-0 bg-card z-10 border-r shadow-[1px_0_0_0_var(--color-border)]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{emp.name}</span>
                            <button
                              onClick={() => handleRegenerateEmployee(emp.id)}
                              disabled={regeneratingEmployeeId !== null}
                              title={`Regenerate ${emp.name}'s planning`}
                              className="flex-shrink-0 p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <RefreshCw className={`h-3 w-3 ${regeneratingEmployeeId === emp.id ? "animate-spin" : ""}`} />
                            </button>
                          </div>
                        </td>
                        {daysInMonth.map(day => {
                          const dateStr = format(day, "yyyy-MM-dd");
                          const entry = planning.entries.find(e => e.employeeId === emp.id && e.date.startsWith(dateStr));
                          const weekend = isWeekend(day);
                          const hasViolation = planning.violations.some(v => v.date.startsWith(dateStr) && (v.employeeId === emp.id || v.employeeId === null));
                          const hasDeskClash = !!(entry?.deskCode && deskClashes.get(dateStr)?.has(emp.id));

                          return (
                            <td key={day.toISOString()} className={`p-1 border-r text-center relative ${weekend ? 'bg-muted/20' : ''} ${hasViolation ? 'bg-destructive/5' : ''}`}>
                              {entry && entry.shiftCode && !weekend ? (
                                <div className="flex flex-col gap-0.5">
                                  {/* Shift code button with override popover */}
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      {(() => {
                                        const codeType = shiftTypeMap.get(entry.shiftCode!);
                                        const style = !hasViolation && codeType ? SHIFT_TYPE_STYLE[codeType] : null;
                                        return (
                                          <button
                                            className={`px-2 py-1 text-xs font-semibold rounded w-full border transition-colors hover:opacity-80 ${hasViolation ? 'bg-destructive/10 text-destructive border-destructive/30 ring-1 ring-destructive' : ''} ${entry.isLocked ? 'ring-1 ring-amber-400' : ''}`}
                                            style={style ? { backgroundColor: style.bg, color: style.text, borderColor: style.border } : undefined}
                                          >
                                            <span className="flex items-center justify-center gap-0.5">
                                              {entry.isLocked && <Lock className="h-2.5 w-2.5 opacity-60 flex-shrink-0" />}
                                              {entry.shiftCode}
                                            </span>
                                          </button>
                                        );
                                      })()}
                                    </PopoverTrigger>
                                    <PopoverContent className="w-52 p-2" side="bottom">
                                      <div className="text-xs font-semibold text-muted-foreground mb-2">Shift Code</div>
                                      <div className="grid grid-cols-2 gap-1">
                                        {shiftCodes?.map(sc => {
                                          const s = SHIFT_TYPE_STYLE[sc.type];
                                          const isActive = sc.code === entry.shiftCode;
                                          return (
                                            <button
                                              key={sc.code}
                                              onClick={() => handleUpdateShift(entry.id, sc.code)}
                                              className={`text-xs font-semibold px-2 py-1.5 rounded border transition-colors hover:opacity-80 ${isActive ? 'ring-2 ring-offset-1' : ''}`}
                                              style={s ? { backgroundColor: s.bg, color: s.text, borderColor: s.border } : undefined}
                                            >
                                              {sc.code}
                                            </button>
                                          );
                                        })}
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="text-destructive text-xs col-span-2"
                                          onClick={() => handleUpdateShift(entry.id, "")}
                                        >
                                          Clear shift
                                        </Button>
                                      </div>
                                    </PopoverContent>
                                  </Popover>

                                  {/* Desk code with override popover */}
                                  <Popover>
                                    <PopoverTrigger asChild>
                                      <button
                                        className={`text-[9px] font-bold font-mono rounded px-1 py-0.5 leading-tight text-center border transition-colors hover:opacity-80 w-full ${hasDeskClash ? 'ring-1 ring-red-500 bg-red-50 text-red-700 border-red-300' : ''}`}
                                        style={!hasDeskClash && entry.deskCode && deskColorMap.get(entry.deskCode)
                                          ? { backgroundColor: deskColorMap.get(entry.deskCode)!.bg, color: deskColorMap.get(entry.deskCode)!.text, borderColor: deskColorMap.get(entry.deskCode)!.bg }
                                          : !hasDeskClash ? { backgroundColor: '#f1f5f9', color: '#94a3b8', borderColor: '#e2e8f0' }
                                          : undefined
                                        }
                                      >
                                        {entry.deskCode || "—"}
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-52 p-2" side="bottom">
                                      <div className="text-xs font-semibold text-muted-foreground mb-2">Desk Override</div>
                                      {hasDeskClash && (
                                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
                                          ⚠ Desk clash — same desk assigned to multiple people
                                        </div>
                                      )}
                                      <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
                                        {allDeskCodes.map(({ code }) => {
                                          const color = deskColorMap.get(code);
                                          const isActive = code === entry.deskCode;
                                          return (
                                            <button
                                              key={code}
                                              onClick={() => handleUpdateDesk(entry.id, code)}
                                              className={`text-xs font-bold font-mono px-2 py-1.5 rounded border transition-colors hover:opacity-80 ${isActive ? 'ring-2 ring-offset-1' : ''}`}
                                              style={color ? { backgroundColor: color.bg, color: color.text, borderColor: color.border } : undefined}
                                            >
                                              {code}
                                            </button>
                                          );
                                        })}
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="text-destructive text-xs col-span-2"
                                          onClick={() => handleUpdateDesk(entry.id, null)}
                                        >
                                          Clear desk
                                        </Button>
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                </div>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center sticky right-0 bg-card z-10 border-l shadow-[-1px_0_0_0_var(--color-border)]">
                          <div className="font-bold text-sm">{planned.toFixed(1)}h</div>
                          {empOfficialHours !== null && (
                            <div className="text-muted-foreground text-[10px]">/ {empOfficialHours.toFixed(1)}h</div>
                          )}
                          {diff !== null && (
                            <div className={`text-xs font-semibold ${over ? 'text-amber-600' : under ? 'text-blue-600' : 'text-green-600'}`}>
                              {diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}h
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                    </Fragment>
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
