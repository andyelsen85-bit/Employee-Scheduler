import { Layout } from "@/components/layout";
import { useParams, Link } from "wouter";
import {
  useGetEmployee,
  getGetEmployeeQueryKey,
  useUpdateEmployee,
  useUpdateEmployeeCounters,
  useListEmployeeTemplates,
  getListEmployeeTemplatesQueryKey,
  useCreateWeekTemplate,
  useUpdateWeekTemplate,
  useDeleteWeekTemplate,
  useListShiftCodes,
  getListShiftCodesQueryKey,
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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const COUNTRY_OPTIONS = [
  { value: "lu", label: "Luxembourg" },
  { value: "be", label: "Belgium" },
  { value: "de", label: "Germany" },
  { value: "fr", label: "France" },
  { value: "other", label: "Other" },
];

export default function EmployeeDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: employee, isLoading } = useGetEmployee(id, {
    query: { queryKey: getGetEmployeeQueryKey(id), enabled: !!id },
  });
  const { data: templates } = useListEmployeeTemplates(id, {
    query: { queryKey: getListEmployeeTemplatesQueryKey(id), enabled: !!id },
  });
  const { data: shiftCodes } = useListShiftCodes({
    query: { queryKey: getListShiftCodesQueryKey() },
  });

  const updateEmployee = useUpdateEmployee();
  const updateCounters = useUpdateEmployeeCounters();
  const createTemplate = useCreateWeekTemplate();
  const updateTemplate = useUpdateWeekTemplate();
  const deleteTemplate = useDeleteWeekTemplate();

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [allowedCodes, setAllowedCodes] = useState<Set<string>>(new Set());
  const [newTemplateName, setNewTemplateName] = useState("");
  const [dayPrefs, setDayPrefs] = useState<Record<string, string | null>>({ Mon: null, Tue: null, Wed: null, Thu: null, Fri: null });
  const [prefersHA, setPrefersHA] = useState(false);

  useEffect(() => {
    if (employee) {
      setForm({
        name: employee.name,
        country: employee.country,
        contractPercent: employee.contractPercent,
        weeklyContractHours: employee.weeklyContractHours,
        homeworkEligible: employee.homeworkEligible,
        coworkEligible: employee.coworkEligible,
        permanenceGroup: employee.permanenceGroup ?? "",
        permanenceLevel: employee.permanenceLevel ?? "",
        isSpoc: employee.isSpoc,
        isManagement: employee.isManagement,
        preferredJlWeekday: employee.preferredJlWeekday ?? "none",
        notes: employee.notes ?? "",
      });
      setCounters({
        prmCounter: employee.prmCounter,
        holidayHoursRemaining: employee.holidayHoursRemaining,
        overtimeHours: employee.overtimeHours,
        homeworkDaysUsedThisYear: employee.homeworkDaysUsedThisYear,
      });
      setAllowedCodes(new Set(employee.allowedShiftCodes ?? []));
      const rawPrefs = (employee as Record<string, unknown>).dayCodePreferences as Record<string, string | null> | null;
      setDayPrefs({ Mon: rawPrefs?.Mon ?? null, Tue: rawPrefs?.Tue ?? null, Wed: rawPrefs?.Wed ?? null, Thu: rawPrefs?.Thu ?? null, Fri: rawPrefs?.Fri ?? null });
      setPrefersHA(!!((employee as Record<string, unknown>).prefersHeightAdjustableDesk));
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
          permanenceLevel: form.permanenceLevel ? Number(form.permanenceLevel) : null,
          preferredJlWeekday: form.preferredJlWeekday === "none" ? null : Number(form.preferredJlWeekday),
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
          ...form,
          contractPercent: Number(form.contractPercent),
          weeklyContractHours: Number(form.weeklyContractHours),
          permanenceGroup: form.permanenceGroup ? Number(form.permanenceGroup) : null,
          permanenceLevel: form.permanenceLevel ? Number(form.permanenceLevel) : null,
          preferredJlWeekday: form.preferredJlWeekday === "none" ? null : Number(form.preferredJlWeekday),
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
          dayCodePreferences: dayPrefs as Record<string, string | null>,
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

  const handleCreateTemplate = () => {
    if (!newTemplateName.trim()) return;
    createTemplate.mutate(
      {
        id,
        data: {
          name: newTemplateName.trim(),
          days: [0, 1, 2, 3, 4].map((d) => ({ dayOfWeek: d, shiftCode: null })),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeTemplatesQueryKey(id) });
          setNewTemplateName("");
          toast({ title: "Template created" });
        },
      }
    );
  };

  const handleUpdateTemplateDay = (
    templateId: number,
    dayOfWeek: number,
    shiftCode: string | null,
    existingDays: Array<{ dayOfWeek: number; shiftCode: string | null }>
  ) => {
    const newDays = existingDays.map((d) =>
      d.dayOfWeek === dayOfWeek ? { ...d, shiftCode } : d
    );
    const tplName = templates?.find((t) => t.id === templateId)?.name ?? "";
    updateTemplate.mutate(
      { id: templateId, data: { name: tplName, days: newDays } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeTemplatesQueryKey(id) });
        },
      }
    );
  };

  const handleDeleteTemplate = (templateId: number) => {
    deleteTemplate.mutate(
      { id: templateId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeTemplatesQueryKey(id) });
          toast({ title: "Template deleted" });
        },
      }
    );
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Permanence Group</Label>
                  <Select value={(form.permanenceGroup ?? "none") as string} onValueChange={(v) => setForm({ ...form, permanenceGroup: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="1">Group 1</SelectItem>
                      <SelectItem value="2">Group 2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Preferred JL Weekday</Label>
                <Select
                  value={String(form.preferredJlWeekday ?? "none")}
                  onValueChange={(v) => setForm({ ...form, preferredJlWeekday: v })}
                >
                  <SelectTrigger><SelectValue placeholder="None (random)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (random)</SelectItem>
                    <SelectItem value="0">Monday</SelectItem>
                    <SelectItem value="1">Tuesday</SelectItem>
                    <SelectItem value="2">Wednesday</SelectItem>
                    <SelectItem value="3">Thursday</SelectItem>
                    <SelectItem value="4">Friday</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">When JL days are inserted to reduce total hours, this weekday is preferred.</p>
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
            <CardTitle>Day Preferences & Desk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-3">
                Set a preferred shift code per weekday. The planner will try to honour these. Leave blank to let the algorithm decide.
              </p>
              <div className="grid grid-cols-5 gap-3">
                {(["Mon", "Tue", "Wed", "Thu", "Fri"] as const).map((day) => (
                  <div key={day} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{day}</Label>
                    <Select
                      value={dayPrefs[day] ?? "none"}
                      onValueChange={(v) => setDayPrefs({ ...dayPrefs, [day]: v === "none" ? null : v })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {allShiftOptions.map((sc) => (
                          <SelectItem key={sc.code} value={sc.code} className="text-xs font-mono">
                            {sc.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
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

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Week Templates</CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Template name"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateTemplate()}
                  className="w-48"
                />
                <Button size="sm" onClick={handleCreateTemplate} disabled={!newTemplateName.trim()}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(!templates || templates.length === 0) && (
              <div className="text-center text-muted-foreground py-8">
                No templates yet. Add a template to define default weekly shift patterns.
              </div>
            )}
            {templates?.map((tpl) => {
              const days = (tpl.days as Array<{ dayOfWeek: number; shiftCode: string | null }>) ?? [];
              return (
                <div key={tpl.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-medium">{tpl.name}</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDeleteTemplate(tpl.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {DAY_NAMES.map((dayName, i) => {
                      const day = days.find((d) => d.dayOfWeek === i) ?? { dayOfWeek: i, shiftCode: null };
                      return (
                        <div key={i} className="space-y-1">
                          <Label className="text-xs text-muted-foreground">{dayName}</Label>
                          <Select
                            value={day.shiftCode ?? "none"}
                            onValueChange={(v) =>
                              handleUpdateTemplateDay(tpl.id, i, v === "none" ? null : v, days)
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">—</SelectItem>
                              {allShiftOptions.map((sc) => (
                                <SelectItem key={sc.code} value={sc.code}>
                                  {sc.code}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
