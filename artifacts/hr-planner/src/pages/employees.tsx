import { Layout } from "@/components/layout";
import { Link } from "wouter";
import {
  useListEmployees,
  getListEmployeesQueryKey,
  useCreateEmployee,
  useDeleteEmployee,
  useListShiftCodes,
  getListShiftCodesQueryKey,
  useBulkResetBalances,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Plus, Search, Pencil, Trash2, User, ShieldCheck, Crown, AlertTriangle, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const COUNTRY_FLAGS: Record<string, string> = {
  lu: "LU", be: "BE", de: "DE", fr: "FR", other: "?",
};

export default function Employees() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCountry, setNewCountry] = useState("lu");

  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetYear, setResetYear] = useState(new Date().getFullYear());
  const [resetC0Hours, setResetC0Hours] = useState(273.6);
  const [resetCodeDefaults, setResetCodeDefaults] = useState<Record<string, number>>({});

  const { data: employees, isLoading } = useListEmployees({
    query: { queryKey: getListEmployeesQueryKey() },
  });
  const { data: shiftCodes } = useListShiftCodes({
    query: { queryKey: getListShiftCodesQueryKey() },
  });

  const activeHolidayCodes = shiftCodes?.filter(
    (sc) => sc.type === "holiday" && sc.hours > 0 && sc.code !== "C0" && sc.isActive
  ) ?? [];

  const createEmployee = useCreateEmployee();
  const deleteEmployee = useDeleteEmployee();
  const bulkReset = useBulkResetBalances();

  const filtered = employees?.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const handleCreate = () => {
    createEmployee.mutate(
      {
        data: {
          name: newName.trim(),
          country: newCountry,
          contractPercent: 100,
          weeklyContractHours: 40,
          homeworkEligible: true,
          coworkEligible: true,
          allowedShiftCodes: ["X80", "TT6", "CW6", "C0", "JL"],
          isSpoc: false,
          spocRotates: false,
          isManagement: false,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
          setCreating(false);
          setNewName("");
          toast({ title: "Employee created" });
        },
      }
    );
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    deleteEmployee.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
          toast({ title: "Employee deleted" });
        },
      }
    );
  };

  const handleOpenResetDialog = () => {
    const nextYear = new Date().getFullYear() + 1;
    setResetYear(nextYear);

    // Pre-populate from stored yearRolloverDefault on shift codes
    const c0Code = shiftCodes?.find((sc) => sc.code === "C0");
    setResetC0Hours((c0Code as { yearRolloverDefault?: number | null } | undefined)?.yearRolloverDefault ?? 273.6);

    const defaults: Record<string, number> = {};
    for (const sc of activeHolidayCodes) {
      defaults[sc.code] = (sc as { yearRolloverDefault?: number | null }).yearRolloverDefault ?? 0;
    }
    setResetCodeDefaults(defaults);
    setResetDialogOpen(true);
  };

  const handleBulkReset = () => {
    bulkReset.mutate(
      {
        data: {
          c0Hours: resetC0Hours,
          balanceDefaults: resetCodeDefaults,
          year: resetYear,
        },
      },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
          setResetDialogOpen(false);
          toast({
            title: "Balances reset",
            description: `${result.employeesReset} employee${result.employeesReset !== 1 ? "s" : ""} reset for ${result.year}.`,
          });
        },
        onError: () => {
          toast({
            title: "Reset failed",
            description: "Could not reset balances. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleOpenResetDialog}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset balances for new year
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Employee
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <User className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-lg font-medium">No employees found</p>
            <p className="text-sm">Add your first employee to get started</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((emp) => (
              <Card key={emp.id} className="hover:bg-muted/20 transition-colors">
                <CardContent className="flex items-center justify-between py-4 px-6">
                  <div className="flex items-center gap-4">
                    <div className="relative h-10 w-10 shrink-0">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary text-sm">
                        {emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      {(emp.holidayHoursRemaining < 0 || emp.holidayBalances.some((b) => b.balanceHours < 0)) && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                          <AlertTriangle className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{emp.name}</span>
                        <Badge variant="outline" className="text-xs">{COUNTRY_FLAGS[emp.country] ?? emp.country.toUpperCase()}</Badge>
                        {emp.isSpoc && <Badge className="text-xs"><ShieldCheck className="h-3 w-3 mr-1" />SPOC</Badge>}
                        {emp.isManagement && <Badge variant="secondary" className="text-xs"><Crown className="h-3 w-3 mr-1" />Mgmt</Badge>}
                        {emp.permanenceGroup && (
                          <Badge variant="outline" className="text-xs">
                            G{emp.permanenceGroup}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-3">
                        <span>PRM: <span className={emp.prmCounter < 0 ? "text-destructive font-medium" : ""}>{emp.prmCounter.toFixed(1)}h</span></span>
                        <span>C0: {emp.holidayHoursRemaining.toFixed(1)}h</span>
                        {activeHolidayCodes.map((sc) => {
                          const balance = emp.holidayBalances.find((b) => b.shiftCode === sc.code);
                          const hours = balance?.balanceHours ?? 0;
                          return (
                            <span key={sc.code}>{sc.code}: <span className={hours < 0 ? "text-destructive font-medium" : ""}>{hours.toFixed(1)}h</span></span>
                          );
                        })}
                        <span>Homework: {emp.homeworkDaysUsedThisYear}d</span>
                        <span>{emp.contractPercent}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/employees/${emp.id}`}>
                      <Button variant="outline" size="sm">
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Edit
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(emp.id, emp.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Employee</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input
                  placeholder="Jane Smith"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Country of Residence</Label>
                <Select value={newCountry} onValueChange={setNewCountry}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lu">Luxembourg</SelectItem>
                    <SelectItem value="be">Belgium</SelectItem>
                    <SelectItem value="de">Germany</SelectItem>
                    <SelectItem value="fr">France</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!newName.trim() || createEmployee.isPending}>
                Create Employee
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Reset balances for new year</DialogTitle>
              <DialogDescription>
                This will overwrite every employee's holiday balances with the values below and log the changes. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Target year</Label>
                <Input
                  type="number"
                  value={resetYear}
                  onChange={(e) => setResetYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
                />
              </div>
              <div className="space-y-1.5">
                <Label>C0 — Main holiday balance (hours)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={resetC0Hours}
                  onChange={(e) => setResetC0Hours(parseFloat(e.target.value) || 0)}
                />
              </div>
              {activeHolidayCodes.length > 0 && (
                <div className="space-y-2">
                  <Label>Other holiday code defaults (hours)</Label>
                  {activeHolidayCodes.map((sc) => (
                    <div key={sc.code} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-sm font-medium">{sc.code}</span>
                      <Input
                        type="number"
                        step="0.1"
                        value={resetCodeDefaults[sc.code] ?? 0}
                        onChange={(e) =>
                          setResetCodeDefaults((prev) => ({
                            ...prev,
                            [sc.code]: parseFloat(e.target.value) || 0,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {employees?.length ?? 0} employee{(employees?.length ?? 0) !== 1 ? "s" : ""} will be affected.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleBulkReset}
                disabled={bulkReset.isPending}
              >
                {bulkReset.isPending ? "Resetting…" : `Reset all balances for ${resetYear}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
