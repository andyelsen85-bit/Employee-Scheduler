import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, RefreshCw, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Layout } from "@/components/layout";

interface SpocEmployee {
  id: number;
  name: string;
}

interface WeekEntry {
  week: number;
  weekStart: string;
  employeeId: number | null;
  isManual: boolean;
}

interface RotationData {
  year: number;
  totalWeeks: number;
  weeks: WeekEntry[];
  spocs: SpocEmployee[];
  rotationOfficeId: number | null;
}

async function fetchRotation(year: number): Promise<RotationData> {
  const res = await fetch(`/api/spoc-rotation/${year}`);
  if (!res.ok) throw new Error("Failed to load SPOC rotation");
  return res.json();
}

async function saveOverride(year: number, week: number, employeeId: number | null) {
  const res = await fetch(`/api/spoc-rotation/${year}/${week}`, {
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

export default function SpocRotationPage() {
  const params = useParams<{ year: string }>();
  const [, navigate] = useLocation();
  const currentYear = parseInt(params.year ?? String(new Date().getFullYear()), 10);

  const [data, setData] = useState<RotationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchRotation(currentYear));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentYear]);

  const handleChange = async (week: number, employeeId: number | null) => {
    setSaving(week);
    try {
      await saveOverride(currentYear, week, employeeId);
      setData((d) => d ? {
        ...d,
        weeks: d.weeks.map((w) =>
          w.week === week ? { ...w, employeeId, isManual: employeeId !== null } : w
        ),
      } : d);
    } catch {
      alert("Failed to save override");
    } finally {
      setSaving(null);
    }
  };

  const handleReset = async (week: number) => {
    setSaving(week);
    try {
      await saveOverride(currentYear, week, null);
      await load();
    } catch {
      alert("Failed to reset override");
    } finally {
      setSaving(null);
    }
  };

  const spocNames: Record<number, string> = {};
  data?.spocs.forEach((s) => { spocNames[s.id] = s.name; });

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <UserCheck className="h-7 w-7" />
              SPOC Rotation
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              One SPOC employee is assigned to the rotation office each week.
              Enable <em>Participates in SPOC rotation</em> on an employee's profile to include them here.
              {data?.rotationOfficeId == null && (
                <span className="text-destructive font-medium"> No rotation office configured — set it in Offices config.</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => navigate(`/spoc-rotation/${currentYear - 1}`)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold text-lg w-14 text-center">{currentYear}</span>
            <Button variant="outline" size="icon" onClick={() => navigate(`/spoc-rotation/${currentYear + 1}`)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {error && <div className="text-destructive text-sm">{error}</div>}

        {loading && !data && (
          <div className="text-muted-foreground text-sm">Loading…</div>
        )}

        {data && (
          <>
            {data.spocs.length === 0 && (
              <div className="text-muted-foreground text-sm border rounded-lg p-4">
                No employees have rotation enabled. Go to an employee's profile and turn on <strong>Participates in SPOC rotation</strong>.
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-2 font-semibold">Week</th>
                    <th className="text-left px-4 py-2 font-semibold">Dates</th>
                    <th className="text-left px-4 py-2 font-semibold">SPOC at rotation office</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => {
                    const isSaving = saving === w.week;
                    return (
                      <tr key={w.week} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 font-mono text-muted-foreground">W{String(w.week).padStart(2, "0")}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {format(parseISO(w.weekStart), "MMM d")} – {getWeekEnd(w.weekStart)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <Select
                              value={w.employeeId != null ? String(w.employeeId) : "none"}
                              onValueChange={(v) => handleChange(w.week, v === "none" ? null : parseInt(v, 10))}
                              disabled={isSaving || data.spocs.length === 0}
                            >
                              <SelectTrigger className="w-52 h-8 text-sm">
                                <SelectValue placeholder="— none —" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">— none —</SelectItem>
                                {data.spocs.map((s) => (
                                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {w.isManual && (
                              <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">manual</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {w.isManual && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => handleReset(w.week)}
                              disabled={isSaving}
                            >
                              Reset to auto
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
