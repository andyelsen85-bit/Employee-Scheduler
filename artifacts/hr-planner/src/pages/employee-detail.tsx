import { Layout } from "@/components/layout";
import { useParams, Link } from "wouter";
import {
  useGetEmployee,
  getGetEmployeeQueryKey,
  useUpdateEmployee,
  useUpdateEmployeeCounters,
  useListShiftCodes,
  getListShiftCodesQueryKey,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListOffices,
  getListOfficesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import { ArrowLeft, Save, Plus, Trash2, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const COUNTRY_OPTIONS = [
  { value: "lu", label: "Luxembourg" },
  { value: "be", label: "Belgium" },
  { value: "de", label: "Germany" },
  { value: "fr", label: "France" },
  { value: "other", label: "Other" },
];

const DAY_OPTIONS = [
  { value: "0", label: "Monday" },
  { value: "1", label: "Tuesday" },
  { value: "2", label: "Wednesday" },
  { value: "3", label: "Thursday" },
  { value: "4", label: "Friday" },
];

type DayPref = { day: number; code: string };

export default function EmployeeDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: employee, isLoading } = useGetEmployee(id, {
    query: { queryKey: getGetEmployeeQueryKey(id), enabled: !!id },
  });
  const { data: shiftCodes } = useListShiftCodes({
    query: { queryKey: getListShiftCodesQueryKey() },
  });
  const { data: departments } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() },
  });
  const { data: officesList } = useListOffices({
    query: { queryKey: getListOfficesQueryKey() },
  });

  const updateEmployee = useUpdateEmployee();
  const updateCounters = useUpdateEmployeeCounters();

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [allowedCodes, setAllowedCodes] = useState<Set<string>>(new Set());
  const [dayPrefs, setDayPrefs] = useState<DayPref[]>([]);
  const [prefersHA, setPrefersHA] = useState(false);
  // adminUsers stores { employeeId (used as approverAdminId FK), username }
  // approverAdminId on employees references employees.id, not users.id
  const [adminUsers, setAdminUsers] = useState<Array<{ employeeId: number; username: string }>>([]);

  useEffect(() => {
    fetch("/api/users", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((users: Array<{ id: number; username: string; role: string; employeeId: number | null }>) => {
        // Only include admin users who are linked to an employee record
        setAdminUsers(
          users
            .filter(u => u.role === "admin" && u.employeeId != null)
            .map(u => ({ employeeId: u.employeeId!, username: u.username }))
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (employee) {
      setForm({
        name: employee.name,
        country: employee.country,
        contractPercent: employee.contractPercent,
        weeklyContractHours: employee.weeklyContractHours,
        homeworkEligible: employee.homeworkEligible,
        coworkEligible: employee.coworkEligible,
        permanenceGroup: employee.permanenceGroup != null ? String(employee.permanenceGroup) : "",
        isSpoc: employee.isSpoc,
        spocRotates: employee.spocRotates,
        isManagement: employee.isManagement,
        departmentId: employee.departmentId ?? null,
        preferredOfficeId: employee.preferredOfficeId ?? null,
        onsiteWeekRatio: employee.onsiteWeekRatio ?? null,
        displayOrder: employee.displayOrder ?? 0,
        notes: employee.notes ?? "",
        role: employee.role ?? "",
        email: employee.email ?? "",
        approverAdminId: employee.approverAdminId ?? null,
      });
      setCounters({
        prmCounter: employee.prmCounter,
        holidayHoursRemaining: employee.holidayHoursRemaining,
        overtimeHours: employee.overtimeHours,
        homeworkDaysUsedThisYear: employee.homeworkDaysUsedThisYear,
      });
      setAllowedCodes(new Set(employee.allowedShiftCodes ?? []));
      const rawPrefs = employee.dayCodePreferences;
      if (Array.isArray(rawPrefs)) {
        setDayPrefs(rawPrefs as DayPref[]);
      } else {
        setDayPrefs([]);
      }
      setPrefersHA(!!(employee.prefersHeightAdjustableDesk));
    }
  }, [employee]);

  const handleSaveProfile = () => {
    updateEmployee.mutate(
      {
        id,
        data: {
          ...form,
          contractPercent: Number(form.contractPercent),
          weeklyContractHours: Number(form.weeklyContractHours),
          permanenceGroup: form.permanenceGroup ? Number(form.permanenceGroup) : null,
          permanenceLevel: null,
          preferredJlWeekday: null,
          displayOrder: Number(form.displayOrder) || 0,
        } as Parameters<typeof updateEmployee.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(id) });
          toast({ title: "Profile saved" });
        },
      }
    );
  };

  const handleSaveCounters = () => {
    updateCounters.mutate(
      {
        id,
        data: {
          prmCounter: Number(counters.prmCounter),
          holidayHoursRemaining: Number(counters.holidayHoursRemaining),
          overtimeHours: Number(counters.overtimeHours),
          homeworkDaysUsedThisYear: Number(counters.homeworkDaysUsedThisYear),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(id) });
          toast({ title: "Counters updated" });
        },
      }
    );
  };

  const FIXED_CODES = ["C0", "JL"];

  const toggleCode = (code: string) => {
    if (FIXED_CODES.includes(code)) return;
    const next = new Set(allowedCodes);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setAllowedCodes(next);
  };

  const handleSaveAllowedCodes = () => {
    const codes = [...allowedCodes, ...FIXED_CODES.filter((c) => !allowedCodes.has(c))];
    updateEmployee.mutate(
      {
        id,
        data: {
          allowedShiftCodes: codes,
        } as Parameters<typeof updateEmployee.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(id) });
          toast({ title: "Allowed shift codes saved" });
        },
      }
    );
  };

  const handleSaveDayPrefs = () => {
    updateEmployee.mutate(
      {
        id,
        data: {
          dayCodePreferences: dayPrefs as Parameters<typeof updateEmployee.mutate>[0]["data"]["dayCodePreferences"],
          prefersHeightAdjustableDesk: prefersHA,
        } as Parameters<typeof updateEmployee.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(id) });
          toast({ title: "Day preferences saved" });
        },
      }
    );
  };

  const addDayPref = () => {
    setDayPrefs([...dayPrefs, { day: 0, code: allShiftOptions[0]?.code ?? "JL" }]);
  };

  const updateDayPref = (idx: number, field: "day" | "code", value: string) => {
    const next = dayPrefs.map((p, i) =>
      i === idx ? { ...p, [field]: field === "day" ? Number(value) : value } : p
    );
    setDayPrefs(next);
  };

  const removeDayPref = (idx: number) => {
    setDayPrefs(dayPrefs.filter((_, i) => i !== idx));
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }

  if (!employee) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Employee not found
        </div>
      </Layout>
    );
  }

  const onsiteShifts = shiftCodes?.filter((sc) => sc.type === "onsite") ?? [];
  const homeworkShifts = shiftCodes?.filter((sc) => sc.type === "homework") ?? [];
  const coworkShifts = shiftCodes?.filter((sc) => sc.type === "cowork") ?? [];
  const holidayShifts = shiftCodes?.filter((sc) => sc.type === "holiday" || sc.type === "jl") ?? [];
  const allShiftOptions = [...onsiteShifts, ...homeworkShifts, ...coworkShifts, ...holidayShifts];

  return (
    <Layout>
      <div className="flex flex-col gap-6 max-w-5xl">
        <div className="flex items-center gap-4">
          <Link href="/employees">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{employee.name}</h1>
          <Badge variant="outline">{employee.country.toUpperCase()}</Badge>
          {employee.isSpoc && <Badge>SPOC</Badge>}
          {employee.isManagement && <Badge variant="secondary">Management</Badge>}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={String(form.name ?? "")} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Input
                  placeholder="e.g. Analyst, Manager, Team Lead"
                  value={String(form.role ?? "")}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Organisational role or job title.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="employee@example.com"
                  value={String(form.email ?? "")}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Used for shift demand notifications.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Approver</Label>
                <Select
                  value={form.approverAdminId != null ? String(form.approverAdminId) : "none"}
                  onValueChange={(v) => setForm({ ...form, approverAdminId: v === "none" ? null : Number(v) })}
                >
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {adminUsers.map(u => (
                      <SelectItem key={u.employeeId} value={String(u.employeeId)}>{u.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Admin who receives and approves shift demand requests from this employee.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Select value={String(form.country ?? "lu")} onValueChange={(v) => setForm({ ...form, country: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Contract %</Label>
                  <Input type="number" value={String(form.contractPercent ?? 100)} onChange={(e) => setForm({ ...form, contractPercent: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Weekly Hours</Label>
                  <Input type="number" value={String(form.weeklyContractHours ?? 40)} onChange={(e) => setForm({ ...form, weeklyContractHours: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Permanence Group</Label>
                <Select value={form.permanenceGroup ? String(form.permanenceGroup) : "none"} onValueChange={(v) => setForm({ ...form, permanenceGroup: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="1">Permanence 1</SelectItem>
                    <SelectItem value="2">Permanence 2</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select
                  value={form.departmentId != null ? String(form.departmentId) : "none"}
                  onValueChange={(v) => setForm({ ...form, departmentId: v === "none" ? null : Number(v) })}
                >
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments?.map(d => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Preferred Office</Label>
                <Select
                  value={form.preferredOfficeId != null ? String(form.preferredOfficeId) : "none"}
                  onValueChange={(v) => setForm({ ...form, preferredOfficeId: v === "none" ? null : Number(v) })}
                >
                  <SelectTrigger><SelectValue placeholder="None (auto)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (auto)</SelectItem>
                    {officesList?.map(o => (
                      <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">The auto-planner will prioritise placing this employee in this office and will try to assign them onsite whenever a desk is free there.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Onsite Week Ratio</Label>
                <Select
                  value={form.onsiteWeekRatio != null ? String(form.onsiteWeekRatio) : "default"}
                  onValueChange={(v) => setForm({ ...form, onsiteWeekRatio: v === "default" ? null : Number(v) })}
                >
                  <SelectTrigger><SelectValue placeholder="Default (floor n/2)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default (floor n/2) — 4w:2, 5w:2, 6w:3, 7w:3</SelectItem>
                    <SelectItem value="0.25">25% — 4w:1, 5w:1, 6w:1, 7w:1</SelectItem>
                    <SelectItem value="0.33">33% — 4w:1, 5w:1, 6w:2, 7w:2</SelectItem>
                    <SelectItem value="0.4">40% — 4w:1, 5w:2, 6w:2, 7w:2</SelectItem>
                    <SelectItem value="0.5">50% — 4w:2, 5w:2, 6w:3, 7w:3</SelectItem>
                    <SelectItem value="0.6">60% — 4w:2, 5w:3, 6w:3, 7w:4</SelectItem>
                    <SelectItem value="0.67">67% — 4w:2, 5w:3, 6w:4, 7w:4</SelectItem>
                    <SelectItem value="0.75">75% — 4w:3, 5w:3, 6w:4, 7w:5</SelectItem>
                    <SelectItem value="1">100% — always onsite</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Overrides the default onsite week distribution used by the auto-planner for this employee only.
                  Only applies when the employee is homework or cowork eligible.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Planning Display Order</Label>
                <Input
                  type="number"
                  min="0"
                  value={String(form.displayOrder ?? 0)}
                  onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">Lower numbers appear first within their department group in the planning view.</p>
              </div>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Homework Eligible</Label>
                  <Switch checked={Boolean(form.homeworkEligible)} onCheckedChange={(v) => setForm({ ...form, homeworkEligible: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Cowork Eligible</Label>
                  <Switch checked={Boolean(form.coworkEligible)} onCheckedChange={(v) => setForm({ ...form, coworkEligible: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>SPOC</Label>
                  <Switch checked={Boolean(form.isSpoc)} onCheckedChange={(v) => setForm({ ...form, isSpoc: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="flex flex-col gap-0.5">
                    <span>Participates in SPOC rotation</span>
                    <span className="text-xs text-muted-foreground font-normal">Included in the weekly rotation schedule</span>
                  </Label>
                  <Switch checked={Boolean(form.spocRotates)} onCheckedChange={(v) => setForm({ ...form, spocRotates: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Management</Label>
                  <Switch checked={Boolean(form.isManagement)} onCheckedChange={(v) => setForm({ ...form, isManagement: v })} />
                </div>
              </div>
              <Button onClick={handleSaveProfile} disabled={updateEmployee.isPending} className="w-full">
                <Save className="h-4 w-4 mr-2" />
                Save Profile
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Counters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>PRM Counter (±10h allowed)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={counters.prmCounter ?? 0}
                  onChange={(e) => setCounters({ ...counters, prmCounter: parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Holiday Hours Remaining</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={counters.holidayHoursRemaining ?? 0}
                  onChange={(e) => setCounters({ ...counters, holidayHoursRemaining: parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Overtime Hours</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={counters.overtimeHours ?? 0}
                  onChange={(e) => setCounters({ ...counters, overtimeHours: parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Homework Days Used (This Year)</Label>
                <Input
                  type="number"
                  value={counters.homeworkDaysUsedThisYear ?? 0}
                  onChange={(e) => setCounters({ ...counters, homeworkDaysUsedThisYear: parseInt(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">Max 35 days/year for BE/DE/FR residents</p>
              </div>
              <Button onClick={handleSaveCounters} disabled={updateCounters.isPending} className="w-full">
                <Save className="h-4 w-4 mr-2" />
                Save Counters
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Allowed Shift Codes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Select which shift codes the auto-planner may assign to this employee.
              C0 and JL are always included. The planner picks the best code from this
              list each day to match the monthly hour target.
            </p>

            {(["onsite", "homework", "cowork"] as const).map((type) => {
              const group = shiftCodes?.filter((sc) => sc.type === type) ?? [];
              const labels: Record<string, string> = { onsite: "Onsite", homework: "Homework (TT)", cowork: "Cowork (CW)" };
              return (
                <div key={type}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{labels[type]}</div>
                  <div className="flex flex-wrap gap-2">
                    {group.map((sc) => {
                      const selected = allowedCodes.has(sc.code);
                      return (
                        <button
                          key={sc.code}
                          type="button"
                          onClick={() => toggleCode(sc.code)}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-mono font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                            ${selected
                              ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                              : "bg-background text-muted-foreground border-input hover:bg-muted"
                            }`}
                        >
                          {sc.code}
                          <span className={`text-xs font-sans ${selected ? "text-primary-foreground/70" : "text-muted-foreground/60"}`}>
                            {sc.hours}h
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Always Included</div>
              <div className="flex flex-wrap gap-2">
                {["C0", "JL"].map((code) => {
                  const sc = shiftCodes?.find((s) => s.code === code);
                  return (
                    <span
                      key={code}
                      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-mono font-medium bg-muted text-muted-foreground border-input cursor-not-allowed opacity-70"
                    >
                      <Lock className="h-3 w-3" />
                      {code}
                      <span className="text-xs font-sans text-muted-foreground/60">{sc?.hours}h</span>
                    </span>
                  );
                })}
              </div>
            </div>

            <Button onClick={handleSaveAllowedCodes} disabled={updateEmployee.isPending} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Save Allowed Codes
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Day Preferences & Desk</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Add weekday/code favourites. The planner tries to honour them — use JL entries to set preferred free-day weekdays.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={addDayPref}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {dayPrefs.length === 0 && (
              <p className="text-sm text-muted-foreground italic text-center py-4">No preferences set — planner will decide freely.</p>
            )}
            <div className="space-y-2">
              {dayPrefs.map((pref, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={String(pref.day)} onValueChange={(v) => updateDayPref(idx, "day", v)}>
                    <SelectTrigger className="w-36 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_OPTIONS.map((d) => (
                        <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={pref.code} onValueChange={(v) => updateDayPref(idx, "code", v)}>
                    <SelectTrigger className="w-36 h-8 text-xs font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allShiftOptions.map((sc) => (
                        <SelectItem key={sc.code} value={sc.code} className="text-xs font-mono">
                          {sc.code} <span className="text-muted-foreground ml-1">{sc.hours}h</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeDayPref(idx)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Prefers height-adjustable desk</p>
                <p className="text-xs text-muted-foreground">The planner will prefer assigning this employee a HA desk when available onsite.</p>
              </div>
              <Switch checked={prefersHA} onCheckedChange={setPrefersHA} />
            </div>

            <Button onClick={handleSaveDayPrefs} disabled={updateEmployee.isPending} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Save Day Preferences
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
