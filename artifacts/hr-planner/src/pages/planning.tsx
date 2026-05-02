import { Layout } from "@/components/layout";
import { useParams, Link } from "wouter";
import { useGetMonthPlanning, getGetMonthPlanningQueryKey, useListEmployees, getListEmployeesQueryKey, useListShiftCodes, getListShiftCodesQueryKey, useGeneratePlanning, useGenerateEmployeePlanning, useConfirmPlanning, useUpdatePlanningEntry, useCreatePlanningEntry, useGetMonthlyConfig, getGetMonthlyConfigQueryKey, useListOffices, getListOfficesQueryKey, useListDepartments, getListDepartmentsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle, Wand2, AlertCircle, Trash2, Lock, RefreshCw, Shield, FileDown, Check, X } from "lucide-react";
import { useState, Fragment, useEffect, useRef } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/context/auth-context";

interface PermanenceWeek {
  weekStart: string;
  g1EmployeeId: number | null;
  g2EmployeeId: number | null;
}

type Demand = {
  id: number;
  employeeId: number;
  year: number;
  month: number;
  day: number;
  demandCode: string;
  status: string;
  decision: { id: number; decision: string } | null;
};

export default function Planning() {
  const params = useParams();
  const year = parseInt(params.year || new Date().getFullYear().toString(), 10);
  const month = parseInt(params.month || (new Date().getMonth() + 1).toString(), 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const gridRef = useRef<HTMLDivElement>(null);

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

  const [demands, setDemands] = useState<Demand[]>([]);
  const [demandLoading, setDemandLoading] = useState(false);

  const loadDemands = async () => {
    setDemandLoading(true);
    try {
      const res = await fetch(`/api/demands?year=${year}&month=${month}`, { credentials: "include" });
      if (res.ok) setDemands(await res.json());
    } catch { /* ignore */ }
    finally { setDemandLoading(false); }
  };

  useEffect(() => { loadDemands(); }, [year, month]);

  const getDemandForCell = (employeeId: number, day: number) =>
    demands.find(d => d.employeeId === employeeId && d.day === day) ?? null;

  const handleSetDemand = async (employeeId: number, day: number, demandCode: string) => {
    try {
      const res = await fetch("/api/demands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ employeeId, year, month, day, demandCode }),
      });
      if (res.ok) await loadDemands();
      else toast({ title: "Failed to save demand", variant: "destructive" });
    } catch { toast({ title: "Failed to save demand", variant: "destructive" }); }
  };

  const handleDeleteDemand = async (demandId: number) => {
    try {
      await fetch(`/api/demands/${demandId}`, { method: "DELETE", credentials: "include" });
      await loadDemands();
    } catch { /* ignore */ }
  };

  const handleDecision = async (demandId: number, decision: "approved" | "rejected") => {
    try {
      const res = await fetch(`/api/demands/${demandId}/decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ decision }),
      });
      if (res.ok) {
        await loadDemands();
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
        toast({ title: decision === "approved" ? "Demand approved" : "Demand rejected" });
      }
    } catch { toast({ title: "Failed to process decision", variant: "destructive" }); }
  };

  // PDF export
  const handleExportPdf = async () => {
    if (!gridRef.current) return;
    toast({ title: "Generating PDF..." });
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: html2canvas } = await import("html2canvas-pro");

      const el = gridRef.current;
      const monthLabel = format(new Date(year, month - 1, 1), "MMMM yyyy");

      const canvas = await html2canvas(el, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: "#ffffff",
        // Capture the full scrollable grid, not just the visible viewport
        width: el.scrollWidth,
        height: el.scrollHeight,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
        scrollX: 0,
        scrollY: 0,
        onclone: (_doc, cloned) => {
          // Remove demand badges from PDF output
          cloned.querySelectorAll<HTMLElement>("[data-pdf-hide]").forEach(e => {
            e.style.display = "none";
          });
          // Defeat sticky positioning — html2canvas renders sticky elements
          // at their viewport-anchored position, causing the "Total Hours"
          // column to overlap mid-table day cells in the export.
          cloned.querySelectorAll<HTMLElement>(".sticky").forEach(e => {
            e.style.position = "static";
            e.style.boxShadow = "none";
          });
          // Ensure full content is visible in the clone
          cloned.style.overflow = "visible";
          cloned.style.width = el.scrollWidth + "px";
          cloned.style.height = el.scrollHeight + "px";
        },
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const titleBlockHeight = 12;

      // Title (month + year) at the top of the page
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text(`Planning — ${monthLabel}`, margin, margin + 7);

      // Fit the captured grid into the remaining space
      const availableWidth = pageWidth - margin * 2;
      const availableHeight = pageHeight - margin * 2 - titleBlockHeight;
      const ratio = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
      pdf.addImage(
        imgData,
        "PNG",
        margin,
        margin + titleBlockHeight,
        canvas.width * ratio,
        canvas.height * ratio,
      );
      pdf.save(`planning-${year}-${String(month).padStart(2, "0")}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
      toast({ title: "Failed to generate PDF", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  // Permanence data for the displayed year (for Shield icon)
  const [permanenceWeeks, setPermanenceWeeks] = useState<PermanenceWeek[]>([]);
  useEffect(() => {
    fetch(`/api/permanence/${year}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.weeks) setPermanenceWeeks(d.weeks);
      })
      .catch(() => {});
  }, [year]);

  const permanenceDateRangesByEmp = new Map<number, Array<[string, string]>>();
  for (const wk of permanenceWeeks) {
    const weekEnd = (() => {
      const d = new Date(wk.weekStart + "T00:00:00");
      d.setDate(d.getDate() + 6);
      return format(d, "yyyy-MM-dd");
    })();
    const range: [string, string] = [wk.weekStart, weekEnd];
    for (const empId of [wk.g1EmployeeId, wk.g2EmployeeId]) {
      if (empId == null) continue;
      if (!permanenceDateRangesByEmp.has(empId)) permanenceDateRangesByEmp.set(empId, []);
      permanenceDateRangesByEmp.get(empId)!.push(range);
    }
  }

  function isEmpOnPermanence(empId: number, dateStr: string): boolean {
    const ranges = permanenceDateRangesByEmp.get(empId);
    if (!ranges) return false;
    return ranges.some(([start, end]) => dateStr >= start && dateStr <= end);
  }

  type EmpRow = NonNullable<typeof employees>[number];
  const byDisplayOrder = (a: EmpRow, b: EmpRow) =>
    (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
  const buildGroups = (emps: EmpRow[], depts: NonNullable<typeof departments>) => {
    const sortedDepts = [...depts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const deptGroups = sortedDepts.map(d => ({
      label: d.name,
      emps: emps.filter(e => e.departmentId === d.id).sort(byDisplayOrder),
    })).filter(g => g.emps.length > 0);
    const assignedEmpIds = new Set(deptGroups.flatMap(g => g.emps.map(e => e.id)));
    const ungrouped = emps.filter(e => !assignedEmpIds.has(e.id)).sort(byDisplayOrder);
    const groups: { label: string | null; emps: EmpRow[] }[] = [];
    for (const g of deptGroups) groups.push(g);
    if (ungrouped.length) groups.push({ label: null, emps: ungrouped });
    return groups;
  };

  const allEmployeeGroups = employees && departments ? buildGroups(employees, departments) : null;

  const myEmployee = !isAdmin && user?.employeeId != null
    ? employees?.find(e => e.id === user.employeeId) ?? null
    : null;

  const myDepartmentGroups = !isAdmin && myEmployee && allEmployeeGroups
    ? allEmployeeGroups.filter(g => g.emps.some(e => e.id === myEmployee.id))
    : null;

  const employeeGroups = isAdmin
    ? allEmployeeGroups
    : myDepartmentGroups && myDepartmentGroups.length > 0
      ? myDepartmentGroups
      : myEmployee
        ? [{ label: null, emps: [myEmployee] }]
        : [];

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

  const shiftCodeColorMap = new Map<string, string>(
    (shiftCodes ?? []).filter(sc => sc.color).map(sc => [sc.code, sc.color!])
  );

  const hexToStyle = (hex: string) => ({ bg: hex + "1e", text: hex, border: hex + "40" });

  const getShiftStyle = (code: string) => {
    const customHex = shiftCodeColorMap.get(code);
    if (customHex) return hexToStyle(customHex);
    const type = shiftTypeMap.get(code) ?? "other";
    return SHIFT_TYPE_STYLE[type] ?? SHIFT_TYPE_STYLE.onsite;
  };

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
      const color = office.color
        ? hexToStyle(office.color)
        : OFFICE_PALETTE[idx % OFFICE_PALETTE.length];
      (office.deskCodes ?? []).forEach((code) => {
        deskColorMap.set(code, color);
        allDeskCodes.push({ code, officeName: office.name });
      });
    });
  }

  const usedDesksByDate = new Map<string, Set<string>>();
  if (planning) {
    for (const e of planning.entries) {
      if (!e.deskCode) continue;
      const key = e.date.slice(0, 10);
      if (!usedDesksByDate.has(key)) usedDesksByDate.set(key, new Set());
      usedDesksByDate.get(key)!.add(e.deskCode);
    }
  }

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
  const createEntry = useCreatePlanningEntry();
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
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
        const affected = data?.negativeBalanceEmployees;
        if (affected && affected.length > 0) {
          toast({
            title: "Planning confirmed — negative balances detected",
            description: `${affected.map((e) => e.name).join(", ")} ${affected.length === 1 ? "has" : "have"} at least one holiday balance below zero.`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Planning confirmed successfully" });
        }
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

  const handleClearUnlocked = async () => {
    if (!confirm("Clear all unlocked (auto-generated) entries for this month? Locked entries will be kept.")) return;
    setIsClearing(true);
    try {
      const res = await fetch(`/api/planning/${year}/${month}?keepLocked=true`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear unlocked planning entries");
      queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
      toast({ title: "Unlocked entries cleared", description: "Locked entries were preserved." });
    } catch {
      toast({ title: "Error clearing entries", variant: "destructive" });
    } finally {
      setIsClearing(false);
    }
  };

  const handleUpdateShift = (entryId: number, shiftCode: string, currentDeskCode?: string | null) => {
    const codeType = shiftTypeMap.get(shiftCode);
    const shouldClearDesk = !!currentDeskCode && codeType !== "onsite";
    updateEntry.mutate(
      { id: entryId, data: { shiftCode: shiftCode || null, ...(shouldClearDesk ? { deskCode: null } : {}) } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) }) }
    );
  };

  const handleUpdateDesk = (entryId: number, deskCode: string | null) => {
    updateEntry.mutate({ id: entryId, data: { deskCode: deskCode || null } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
      }
    });
  };

  const handleCreateEntry = (employeeId: number, date: string, shiftCode: string | null) => {
    createEntry.mutate({ year, month, data: { employeeId, date, shiftCode } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
      }
    });
  };

  const handleSetDesk = (entryId: number | undefined, employeeId: number, date: string, deskCode: string | null) => {
    if (entryId !== undefined) {
      handleUpdateDesk(entryId, deskCode);
    } else {
      createEntry.mutate({ year, month, data: { employeeId, date, deskCode } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMonthPlanningQueryKey(year, month) });
        }
      });
    }
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

  const shiftCodesInfoMap = new Map<string, { hours: number; scalesWithContract?: boolean }>(
    (shiftCodes ?? []).map(sc => [sc.code, { hours: sc.hours, scalesWithContract: sc.scalesWithContract ?? false }])
  );

  const officialHours = monthlyConfig?.contractualHours ?? null;
  const currentMonthPrefix = `${year}-${String(month).padStart(2, "0")}-`;

  function getEmployeePlannedHours(empId: number): number {
    if (!planning) return 0;
    const emp = employees?.find(e => e.id === empId);
    const contractPct = emp?.contractPercent ?? 100;
    return planning.entries
      .filter(e => e.employeeId === empId && e.shiftCode && e.date.startsWith(currentMonthPrefix))
      .reduce((sum, e) => {
        const info = shiftCodesInfoMap.get(e.shiftCode!);
        if (!info) return sum;
        const h = info.scalesWithContract && contractPct !== 100 ? info.hours * (contractPct / 100) : info.hours;
        return sum + h;
      }, 0);
  }

  const lockedCount = planning ? planning.entries.filter(e => e.isLocked && e.date.startsWith(currentMonthPrefix)).length : 0;

  if (!isAdmin && user?.employeeId == null) {
    return (
      <Layout>
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight">My Planning</h1>
          <div className="border rounded-xl bg-card p-8 flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground" />
            <div>
              <div className="font-semibold text-lg mb-1">Account not linked to an employee</div>
              <div className="text-muted-foreground text-sm">
                Your user account is not linked to any employee record yet.<br />
                Please contact your HR administrator to have your account linked so you can submit shift requests.
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col gap-6 h-full">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight">{isAdmin ? "Planning" : "My Planning"}</h1>
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
          
          <div className="flex gap-2 flex-wrap">
            {isAdmin && (
              <>
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
                  <Button variant="outline" size="sm" onClick={handleClearUnlocked} disabled={isClearing} className="text-orange-700 border-orange-400 hover:bg-orange-50">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear unlocked
                  </Button>
                )}
                {planning && (
                  <Button variant="outline" size="sm" onClick={handleClear} disabled={isClearing} className="text-destructive border-destructive/40 hover:bg-destructive/10">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear all
                  </Button>
                )}
              </>
            )}
            <Button variant="outline" size="sm" onClick={handleExportPdf}>
              <FileDown className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </div>

        {!isAdmin && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-500" />
            <span>
              This is your personal planning view. Click on any day in your row to request a specific shift code — your request will appear as pending until an admin approves or rejects it.
            </span>
          </div>
        )}

        {planning?.violations && planning.violations.length > 0 && isAdmin && (
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
              No planning data available for this month.<br />
              {isAdmin ? "Click Generate to create a draft." : "No planning has been generated yet."}
            </div>
          ) : (
            <div ref={gridRef} className="overflow-auto flex-1 relative">
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
                    const isMyRow = !isAdmin && user?.employeeId === emp.id;

                    return (
                      <tr key={emp.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-2 py-2 font-medium sticky left-0 bg-card z-10 border-r shadow-[1px_0_0_0_var(--color-border)]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate">{emp.name}</span>
                            {isAdmin && (
                              <button
                                onClick={() => handleRegenerateEmployee(emp.id)}
                                disabled={regeneratingEmployeeId !== null}
                                title={`Regenerate ${emp.name}'s planning`}
                                className="flex-shrink-0 p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <RefreshCw className={`h-3 w-3 ${regeneratingEmployeeId === emp.id ? "animate-spin" : ""}`} />
                              </button>
                            )}
                          </div>
                        </td>
                        {daysInMonth.map(day => {
                          const dateStr = format(day, "yyyy-MM-dd");
                          const dayNum = day.getDate();
                          const entry = planning.entries.find(e => e.employeeId === emp.id && e.date.startsWith(dateStr));
                          const weekend = isWeekend(day);
                          const hasViolation = planning.violations.some(v => v.date.startsWith(dateStr) && (v.employeeId === emp.id || v.employeeId === null));
                          const hasDeskClash = !!(entry?.deskCode && deskClashes.get(dateStr)?.has(emp.id));
                          const hasShift = !!(entry?.shiftCode);
                          const isOnPermanence = !weekend && isEmpOnPermanence(emp.id, dateStr);
                          const demand = !weekend ? getDemandForCell(emp.id, dayNum) : null;
                          const canAddDemand = !isAdmin && isMyRow && !weekend;

                          return (
                            <td key={day.toISOString()} className={`p-1 border-r text-center relative ${weekend ? 'bg-muted/20' : ''} ${hasViolation ? 'bg-destructive/5' : ''}`}>
                              {!weekend && (
                                <div className="flex flex-col gap-0.5">
                                  {isOnPermanence && (
                                    <div className="flex justify-end pr-0.5">
                                      <Shield className="h-2.5 w-2.5 text-blue-400/70" aria-label="Permanence duty" />
                                    </div>
                                  )}

                                  {/* ── Shift code ── */}
                                  {isAdmin ? (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        {(() => {
                                          if (hasShift) {
                                            const style = !hasViolation ? getShiftStyle(entry!.shiftCode!) : null;
                                            return (
                                              <button
                                                className={`text-xs font-bold font-mono rounded px-1 py-0.5 leading-tight text-center transition-colors hover:opacity-80 w-full ${entry!.isLocked ? 'border-2 border-red-600' : 'border'}`}
                                                style={style ? { backgroundColor: style.bg, color: style.text, borderColor: entry!.isLocked ? '#dc2626' : style.border } : undefined}
                                              >
                                                {entry!.shiftCode}
                                              </button>
                                            );
                                          }
                                          return (
                                            <button className="w-full h-6 flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-muted/40 rounded transition-colors text-xs">
                                              +
                                            </button>
                                          );
                                        })()}
                                      </PopoverTrigger>
                                      <PopoverContent className="w-52 p-2" side="bottom">
                                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                                          {hasShift ? "Change Shift Code" : "Set Shift Code"}
                                        </div>
                                        <div className="grid grid-cols-2 gap-1">
                                          {shiftCodes?.map(sc => {
                                            const s = getShiftStyle(sc.code);
                                            const isActive = sc.code === entry?.shiftCode;
                                            return (
                                              <button
                                                key={sc.code}
                                                onClick={() => hasShift
                                                  ? handleUpdateShift(entry!.id, sc.code, entry?.deskCode)
                                                  : handleCreateEntry(emp.id, dateStr, sc.code)
                                                }
                                                className={`text-xs font-semibold px-2 py-1.5 rounded border transition-colors hover:opacity-80 ${isActive ? 'ring-2 ring-offset-1' : ''}`}
                                                style={s ? { backgroundColor: s.bg, color: s.text, borderColor: s.border } : undefined}
                                              >
                                                {sc.code}
                                              </button>
                                            );
                                          })}
                                          {hasShift && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="text-destructive text-xs col-span-2"
                                              onClick={() => handleUpdateShift(entry!.id, "", entry?.deskCode)}
                                            >
                                              Clear shift
                                            </Button>
                                          )}
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                  ) : (
                                    <div
                                      className={`text-xs font-bold font-mono rounded px-1 py-0.5 leading-tight text-center w-full ${hasShift ? '' : 'opacity-0'} ${entry?.isLocked ? 'border-2 border-red-600' : 'border'}`}
                                      style={hasShift && !hasViolation ? (() => { const s = getShiftStyle(entry!.shiftCode!); return { backgroundColor: s.bg, color: s.text, borderColor: entry!.isLocked ? '#dc2626' : s.border }; })() : undefined}
                                    >
                                      {entry?.shiftCode ?? "—"}
                                    </div>
                                  )}

                                  {/* ── Desk code ── */}
                                  {isAdmin ? (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        {(() => {
                                          if (hasShift) {
                                            const isOnsite = shiftTypeMap.get(entry!.shiftCode!) === "onsite";
                                            const missingDesk = isOnsite && !entry!.deskCode;
                                            return (
                                              <button
                                                className={`text-[9px] font-bold font-mono rounded px-1 py-0.5 leading-tight text-center border transition-colors hover:opacity-80 w-full ${hasDeskClash ? 'ring-1 ring-red-500 bg-red-50 text-red-700 border-red-300' : ''}`}
                                                style={hasDeskClash ? undefined
                                                  : missingDesk ? { backgroundColor: '#7f1d1d', color: '#fef2f2', borderColor: '#991b1b' }
                                                  : entry!.deskCode && deskColorMap.get(entry!.deskCode)
                                                    ? { backgroundColor: deskColorMap.get(entry!.deskCode)!.bg, color: deskColorMap.get(entry!.deskCode)!.text, borderColor: deskColorMap.get(entry!.deskCode)!.bg }
                                                    : { backgroundColor: '#f1f5f9', color: '#94a3b8', borderColor: '#e2e8f0' }
                                                }
                                              >
                                                {entry!.deskCode || "—"}
                                              </button>
                                            );
                                          }
                                          return (
                                            <button className="w-full h-4 flex items-center justify-center text-muted-foreground/20 hover:text-muted-foreground/50 hover:bg-muted/30 rounded transition-colors text-[9px] font-mono">
                                              —
                                            </button>
                                          );
                                        })()}
                                      </PopoverTrigger>
                                      <PopoverContent className="w-52 p-2" side="bottom">
                                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                                          {hasDeskClash && (
                                            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
                                              ⚠ Desk clash — same desk assigned to multiple people
                                            </div>
                                          )}
                                          Desk
                                        </div>
                                        <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
                                          {allDeskCodes.map(({ code }) => {
                                            const color = deskColorMap.get(code);
                                            const isActive = code === entry?.deskCode;
                                            return (
                                              <button
                                                key={code}
                                                onClick={() => handleSetDesk(entry?.id, emp.id, dateStr, code)}
                                                className={`text-xs font-bold font-mono px-2 py-1.5 rounded border transition-colors hover:opacity-80 ${isActive ? 'ring-2 ring-offset-1' : ''}`}
                                                style={color ? { backgroundColor: color.bg, color: color.text, borderColor: color.border } : undefined}
                                              >
                                                {code}
                                              </button>
                                            );
                                          })}
                                          {entry?.deskCode && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="text-destructive text-xs col-span-2"
                                              onClick={() => handleSetDesk(entry!.id, emp.id, dateStr, null)}
                                            >
                                              Clear desk
                                            </Button>
                                          )}
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                  ) : (
                                    <div
                                      className={`text-[9px] font-bold font-mono rounded px-1 py-0.5 leading-tight text-center border w-full ${hasShift ? '' : 'opacity-0'}`}
                                      style={hasShift && entry?.deskCode && deskColorMap.get(entry.deskCode) ? { backgroundColor: deskColorMap.get(entry.deskCode)!.bg, color: deskColorMap.get(entry.deskCode)!.text, borderColor: deskColorMap.get(entry.deskCode)!.border } : { backgroundColor: '#f1f5f9', color: '#94a3b8', borderColor: '#e2e8f0' }}
                                    >
                                      {entry?.deskCode ?? "—"}
                                    </div>
                                  )}

                                  {/* ── Demand row ── */}
                                  <div data-pdf-hide>
                                  {isAdmin ? (
                                    demand ? (
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <button
                                            className={`text-[9px] font-bold font-mono rounded px-1 py-0.5 leading-tight text-center border transition-colors hover:opacity-80 w-full flex items-center justify-center gap-0.5 ${
                                              demand.status === "approved"
                                                ? "bg-green-50 text-green-700 border-green-300"
                                                : demand.status === "rejected"
                                                ? "bg-red-50 text-red-600 border-red-200 line-through opacity-60"
                                                : "bg-yellow-50 text-yellow-700 border-yellow-300"
                                            }`}
                                          >
                                            {demand.status === "approved" && <Check className="h-2 w-2 flex-shrink-0" />}
                                            {demand.status === "rejected" && <X className="h-2 w-2 flex-shrink-0" />}
                                            {demand.demandCode}
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-44 p-2" side="bottom">
                                          <div className="text-xs font-semibold text-muted-foreground mb-2">
                                            Demand: {demand.demandCode}
                                          </div>
                                          <div className="flex gap-1">
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="flex-1 text-xs text-green-700 border-green-400 hover:bg-green-50"
                                              onClick={() => handleDecision(demand.id, "approved")}
                                            >
                                              <Check className="h-3 w-3 mr-1" /> Approve
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="flex-1 text-xs text-red-700 border-red-400 hover:bg-red-50"
                                              onClick={() => handleDecision(demand.id, "rejected")}
                                            >
                                              <X className="h-3 w-3 mr-1" /> Reject
                                            </Button>
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                    ) : (
                                      <div className="h-4" />
                                    )
                                  ) : canAddDemand ? (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        {demand ? (
                                          <button
                                            className={`text-[9px] font-bold font-mono rounded px-1 py-0.5 leading-tight text-center border transition-colors hover:opacity-80 w-full flex items-center justify-center gap-0.5 ${
                                              demand.status === "approved"
                                                ? "bg-green-50 text-green-700 border-green-300"
                                                : demand.status === "rejected"
                                                ? "bg-red-50 text-red-600 border-red-200 line-through opacity-60"
                                                : "bg-yellow-50 text-yellow-700 border-yellow-300"
                                            }`}
                                          >
                                            {demand.status === "approved" && <Check className="h-2 w-2 flex-shrink-0" />}
                                            {demand.status === "rejected" && <X className="h-2 w-2 flex-shrink-0" />}
                                            {demand.demandCode}
                                          </button>
                                        ) : (
                                          <button className="w-full h-4 flex items-center justify-center text-muted-foreground/20 hover:text-purple-400/60 hover:bg-purple-50/30 rounded transition-colors text-[9px] font-mono">
                                            req
                                          </button>
                                        )}
                                      </PopoverTrigger>
                                      <PopoverContent className="w-52 p-2" side="bottom">
                                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                                          Request Shift
                                        </div>
                                        <div className="grid grid-cols-2 gap-1">
                                          {shiftCodes?.map(sc => {
                                            const s = getShiftStyle(sc.code);
                                            const isActive = sc.code === demand?.demandCode;
                                            return (
                                              <button
                                                key={sc.code}
                                                onClick={() => handleSetDemand(emp.id, dayNum, sc.code)}
                                                className={`text-xs font-semibold px-2 py-1.5 rounded border transition-colors hover:opacity-80 ${isActive ? 'ring-2 ring-offset-1' : ''}`}
                                                style={s ? { backgroundColor: s.bg, color: s.text, borderColor: s.border } : undefined}
                                              >
                                                {sc.code}
                                              </button>
                                            );
                                          })}
                                          {demand && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="text-destructive text-xs col-span-2"
                                              onClick={() => handleDeleteDemand(demand.id)}
                                            >
                                              Remove request
                                            </Button>
                                          )}
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                  ) : (
                                    <div className="h-4" />
                                  )}
                                  </div>
                                </div>
                              )}
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
                  {/* Free desks row */}
                  {allDeskCodes.length > 0 && (
                    <>
                      <tr className="border-t-2 border-border bg-muted/30 sticky bottom-0 z-10">
                        <td className="px-2 py-1.5 font-semibold text-xs text-muted-foreground sticky left-0 bg-muted/30 z-20 border-r shadow-[1px_0_0_0_var(--color-border)] whitespace-nowrap">
                          Free Desks
                        </td>
                        {daysInMonth.map(day => {
                          const dateStr = format(day, "yyyy-MM-dd");
                          const weekend = isWeekend(day);
                          if (weekend) {
                            return <td key={day.toISOString()} className="border-r bg-muted/40" />;
                          }
                          const used = usedDesksByDate.get(dateStr) ?? new Set<string>();
                          const freeDesks = allDeskCodes.filter(({ code }) => !used.has(code));
                          return (
                            <td key={day.toISOString()} className="p-1 border-r align-top">
                              <div className="flex flex-col gap-0.5">
                                {freeDesks.map(({ code }) => {
                                  const color = deskColorMap.get(code);
                                  return (
                                    <span
                                      key={code}
                                      className="text-[9px] font-bold font-mono rounded px-1 py-0.5 leading-tight text-center block border"
                                      style={color
                                        ? { backgroundColor: color.bg, color: color.text, borderColor: color.border }
                                        : { backgroundColor: '#f1f5f9', color: '#94a3b8', borderColor: '#e2e8f0' }
                                      }
                                    >
                                      {code}
                                    </span>
                                  );
                                })}
                                {freeDesks.length === 0 && (
                                  <span className="text-[9px] text-muted-foreground text-center">full</span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-1.5 sticky right-0 bg-muted/30 z-20 border-l shadow-[-1px_0_0_0_var(--color-border)]" />
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
