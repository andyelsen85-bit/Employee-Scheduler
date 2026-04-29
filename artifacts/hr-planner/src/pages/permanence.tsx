import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface WeekEntry {
  week: number;
  weekStart: string;
  g1EmployeeId: number | null;
  g2EmployeeId: number | null;
  g1Manual: boolean;
  g2Manual: boolean;
}

interface PermanenceEmployee {
  id: number;
  name: string;
  permanenceGroup: number | null;
}

interface PermanenceData {
  year: number;
  totalWeeks: number;
  weeks: WeekEntry[];
  employees: PermanenceEmployee[];
}

async function fetchPermanence(year: number): Promise<PermanenceData> {
  const res = await fetch(`/api/permanence/${year}`);
  if (!res.ok) throw new Error("Failed to load permanence data");
  return res.json();
}

async function saveOverride(year: number, week: number, group: number, employeeId: number | null) {
  const res = await fetch(`/api/permanence/${year}/${week}/${group}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  if (!res.ok) throw new Error("Failed to save override");
}

function getWeekEnd(weekStart: string): string {
  const d = parseISO(weekStart);
  d.setDate(d.getDate() + 6);
  return format(d, "MMM d");
}

export default function PermanencePage() {
  const params = useParams<{ year: string }>();
  const [, navigate] = useLocation();
  const currentYear = parseInt(params.year ?? String(new Date().getFullYear()), 10);

  const [data, setData] = useState<PermanenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetchPermanence(currentYear)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  if (!data && !loading && !error) load();

  function goYear(delta: number) {
    navigate(`/permanence/${currentYear + delta}`);
    setData(null);
  }

  async function handleOverride(week: number, group: 1 | 2, value: string) {
    if (!data) return;
    const employeeId = value === "auto" ? null : parseInt(value, 10);
    const key = `${week}-${group}`;
    setSaving(key);
    try {
      await saveOverride(currentYear, week, group, employeeId);
      const updated = { ...data };
      const weekEntry = updated.weeks.find(w => w.week === week);
      if (weekEntry) {
        if (group === 1) {
          weekEntry.g1EmployeeId = employeeId ?? rotateAssign(updated.employees.filter(e => e.permanenceGroup === 1), week - 1);
          weekEntry.g1Manual = employeeId !== null;
        } else {
          weekEntry.g2EmployeeId = employeeId ?? rotateAssign(updated.employees.filter(e => e.permanenceGroup === 2), week - 1);
          weekEntry.g2Manual = employeeId !== null;
        }
      }
      setData({ ...updated });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  function rotateAssign(group: PermanenceEmployee[], weekIdx: number): number | null {
    if (group.length === 0) return null;
    return group[weekIdx % group.length].id;
  }

  const empById = new Map(data?.employees.map(e => [e.id, e]));
  const group1Emps = data?.employees.filter(e => e.permanenceGroup === 1) ?? [];
  const group2Emps = data?.employees.filter(e => e.permanenceGroup === 2) ?? [];

  const today = format(new Date(), "yyyy-MM-dd");
  const currentWeekStart = (() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return format(d, "yyyy-MM-dd");
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Permanence Schedule</h1>
            <p className="text-muted-foreground text-sm">Year-round on-call assignment by group</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => goYear(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-lg w-16 text-center">{currentYear}</span>
          <Button variant="outline" size="icon" onClick={() => goYear(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">{error}</div>}

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">Loading…</div>
      )}

      {data && !loading && (
        <div className="space-y-3">
          <div className="flex gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-blue-500/70" />
              Group 1 ({group1Emps.length} members)
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-purple-500/70" />
              Group 2 ({group2Emps.length} members)
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              Manual override
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="px-4 py-2.5 text-left font-semibold w-20">Week</th>
                  <th className="px-4 py-2.5 text-left font-semibold w-44">Dates</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Group 1</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Group 2</th>
                </tr>
              </thead>
              <tbody>
                {data.weeks.map(wk => {
                  const isCurrentWeek = wk.weekStart === currentWeekStart;
                  const isPast = wk.weekStart < currentWeekStart;
                  const g1Name = wk.g1EmployeeId ? empById.get(wk.g1EmployeeId)?.name ?? `#${wk.g1EmployeeId}` : "—";
                  const g2Name = wk.g2EmployeeId ? empById.get(wk.g2EmployeeId)?.name ?? `#${wk.g2EmployeeId}` : "—";

                  return (
                    <tr
                      key={wk.week}
                      className={`border-b transition-colors ${isCurrentWeek ? "bg-blue-50 dark:bg-blue-950/30" : isPast ? "opacity-60" : "hover:bg-muted/20"}`}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold">W{wk.week}</span>
                          {isCurrentWeek && <Badge variant="secondary" className="text-[10px] px-1 py-0">now</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {format(parseISO(wk.weekStart), "MMM d")} – {getWeekEnd(wk.weekStart)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Select
                            value={wk.g1Manual && wk.g1EmployeeId != null ? String(wk.g1EmployeeId) : "auto"}
                            onValueChange={v => handleOverride(wk.week, 1, v)}
                            disabled={saving === `${wk.week}-1`}
                          >
                            <SelectTrigger className="h-7 text-xs w-44 border-blue-200 focus:border-blue-400">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto" className="text-xs">
                                <span className="text-muted-foreground">Auto: </span>{g1Name}
                              </SelectItem>
                              {group1Emps.map(e => (
                                <SelectItem key={e.id} value={String(e.id)} className="text-xs">{e.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {wk.g1Manual && (
                            <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" title="Manual override" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Select
                            value={wk.g2Manual && wk.g2EmployeeId != null ? String(wk.g2EmployeeId) : "auto"}
                            onValueChange={v => handleOverride(wk.week, 2, v)}
                            disabled={saving === `${wk.week}-2`}
                          >
                            <SelectTrigger className="h-7 text-xs w-44 border-purple-200 focus:border-purple-400">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto" className="text-xs">
                                <span className="text-muted-foreground">Auto: </span>{g2Name}
                              </SelectItem>
                              {group2Emps.map(e => (
                                <SelectItem key={e.id} value={String(e.id)} className="text-xs">{e.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {wk.g2Manual && (
                            <div className="h-2 w-2 rounded-full bg-amber-400 shrink-0" title="Manual override" />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
