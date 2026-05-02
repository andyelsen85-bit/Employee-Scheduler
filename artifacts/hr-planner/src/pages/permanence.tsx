import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, RefreshCw, Shield, ArrowUp, ArrowDown, RotateCcw, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Layout } from "@/components/layout";

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

interface RotationOrderItem {
  employeeId: number;
  name: string;
  permanenceGroup: number | null;
  rotationOrder: number;
}

async function fetchPermanence(year: number): Promise<PermanenceData> {
  const res = await fetch(`/api/permanence/${year}`);
  if (!res.ok) throw new Error("Failed to load permanence data");
  return res.json();
}

async function fetchRotationOrder(): Promise<RotationOrderItem[]> {
  const res = await fetch("/api/permanence/rotation-order");
  if (!res.ok) throw new Error("Failed to load rotation order");
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

async function saveRotationOrder(items: Array<{ employeeId: number; rotationOrder: number }>) {
  const res = await fetch("/api/permanence/rotation-order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });
  if (!res.ok) throw new Error("Failed to save rotation order");
}

async function recalculate(year: number) {
  const res = await fetch(`/api/permanence/${year}/recalculate`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to recalculate");
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

  // Rotation order dialog state
  const [rotationDialogOpen, setRotationDialogOpen] = useState(false);
  const [rotationItems, setRotationItems] = useState<RotationOrderItem[]>([]);
  const [rotationLoading, setRotationLoading] = useState(false);
  const [rotationSaving, setRotationSaving] = useState(false);

  // Recalculate state
  const [recalcConfirmOpen, setRecalcConfirmOpen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

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
      // Reload from backend so the displayed auto-assignment reflects the actual
      // rotation order (client-side recomputation would ignore the saved order).
      const fresh = await fetchPermanence(currentYear);
      setData(fresh);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  async function openRotationDialog() {
    setRotationDialogOpen(true);
    setRotationLoading(true);
    try {
      const items = await fetchRotationOrder();
      // Sort by group then by current rotationOrder
      items.sort((a, b) => {
        if ((a.permanenceGroup ?? 0) !== (b.permanenceGroup ?? 0)) {
          return (a.permanenceGroup ?? 0) - (b.permanenceGroup ?? 0);
        }
        return a.rotationOrder - b.rotationOrder;
      });
      setRotationItems(items);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load rotation order");
      setRotationDialogOpen(false);
    } finally {
      setRotationLoading(false);
    }
  }

  function moveRotationItem(group: number, index: number, direction: -1 | 1) {
    const groupItems = rotationItems.filter(i => i.permanenceGroup === group);
    const otherItems = rotationItems.filter(i => i.permanenceGroup !== group);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= groupItems.length) return;
    const reordered = [...groupItems];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    const updated = reordered.map((item, idx) => ({ ...item, rotationOrder: idx }));
    setRotationItems([...otherItems, ...updated].sort((a, b) => {
      if ((a.permanenceGroup ?? 0) !== (b.permanenceGroup ?? 0)) {
        return (a.permanenceGroup ?? 0) - (b.permanenceGroup ?? 0);
      }
      return a.rotationOrder - b.rotationOrder;
    }));
  }

  async function handleSaveRotationOrder() {
    setRotationSaving(true);
    try {
      await saveRotationOrder(rotationItems.map(i => ({ employeeId: i.employeeId, rotationOrder: i.rotationOrder })));
      setRotationDialogOpen(false);
      // Reload data to reflect new rotation
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save rotation order");
    } finally {
      setRotationSaving(false);
    }
  }

  async function handleRecalculate() {
    setRecalcConfirmOpen(false);
    setRecalculating(true);
    try {
      await recalculate(currentYear);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Recalculate failed");
    } finally {
      setRecalculating(false);
    }
  }

  const empById = new Map(data?.employees.map(e => [e.id, e]));
  const group1Emps = data?.employees.filter(e => e.permanenceGroup === 1) ?? [];
  const group2Emps = data?.employees.filter(e => e.permanenceGroup === 2) ?? [];

  const currentWeekStart = (() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return format(d, "yyyy-MM-dd");
  })();

  const rotGroup1 = rotationItems.filter(i => i.permanenceGroup === 1);
  const rotGroup2 = rotationItems.filter(i => i.permanenceGroup === 2);

  return (
    <Layout>
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
          <Button variant="outline" size="sm" onClick={openRotationDialog} disabled={loading}>
            <ListOrdered className="h-4 w-4 mr-2" />
            Rotation Order
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRecalcConfirmOpen(true)}
            disabled={loading || recalculating}
            className="text-amber-700 border-amber-400 hover:bg-amber-50"
          >
            <RotateCcw className={`h-4 w-4 mr-2 ${recalculating ? "animate-spin" : ""}`} />
            Recalculate
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
              Permanence 1 ({group1Emps.length} members)
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-purple-500/70" />
              Permanence 2 ({group2Emps.length} members)
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
                  <th className="px-4 py-2.5 text-left font-semibold">Permanence 1</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Permanence 2</th>
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

    {/* Rotation Order Dialog */}
    <Dialog open={rotationDialogOpen} onOpenChange={setRotationDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListOrdered className="h-5 w-5" />
            Rotation Order
          </DialogTitle>
        </DialogHeader>

        {rotationLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : (
          <div className="space-y-5">
            {[1, 2].map(group => {
              const items = group === 1 ? rotGroup1 : rotGroup2;
              return (
                <div key={group}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${group === 1 ? "bg-blue-500/70" : "bg-purple-500/70"}`} />
                    <span className="font-semibold text-sm">Permanence {group}</span>
                    <span className="text-xs text-muted-foreground">({items.length} members)</span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground pl-4">No members assigned to this group.</p>
                  ) : (
                    <div className="space-y-1">
                      {items.map((item, idx) => (
                        <div key={item.employeeId} className="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/20">
                          <span className="text-xs font-mono text-muted-foreground w-5 text-center">{idx + 1}</span>
                          <span className="flex-1 text-sm">{item.name}</span>
                          <button
                            onClick={() => moveRotationItem(group, idx, -1)}
                            disabled={idx === 0}
                            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move up"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => moveRotationItem(group, idx, 1)}
                            disabled={idx === items.length - 1}
                            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move down"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setRotationDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveRotationOrder} disabled={rotationSaving || rotationLoading}>
            {rotationSaving ? "Saving…" : "Save Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Recalculate Confirmation Dialog */}
    <Dialog open={recalcConfirmOpen} onOpenChange={setRecalcConfirmOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-amber-600" />
            Recalculate {currentYear}?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This will clear all manual overrides for <strong>{currentYear}</strong> and regenerate every week assignment using the current rotation order. This action cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRecalcConfirmOpen(false)}>Cancel</Button>
          <Button
            onClick={handleRecalculate}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Yes, Recalculate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </Layout>
  );
}
