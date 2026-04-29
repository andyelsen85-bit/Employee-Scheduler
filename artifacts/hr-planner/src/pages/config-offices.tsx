import { Layout } from "@/components/layout";
import {
  useListOffices,
  getListOfficesQueryKey,
  useCreateOffice,
  useUpdateOffice,
  useDeleteOffice,
  useUpdateOfficeEmployees,
  useListEmployees,
  getListEmployeesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { Plus, Pencil, Trash2, Building2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type OfficeForm = { name: string; deskCount: number };

export default function OfficesConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<null | "create" | number>(null);
  const [form, setForm] = useState<OfficeForm>({ name: "", deskCount: 10 });
  const [selectedEmployees, setSelectedEmployees] = useState<Set<number>>(new Set());
  const [deskCodes, setDeskCodes] = useState<Record<number, string>>({});

  const { data: offices, isLoading } = useListOffices({
    query: { queryKey: getListOfficesQueryKey() },
  });
  const { data: employees } = useListEmployees({
    query: { queryKey: getListEmployeesQueryKey() },
  });

  const createOffice = useCreateOffice();
  const updateOffice = useUpdateOffice();
  const deleteOffice = useDeleteOffice();
  const updateOfficeEmployees = useUpdateOfficeEmployees();

  const openCreate = () => {
    setForm({ name: "", deskCount: 10 });
    setSelectedEmployees(new Set());
    setDeskCodes({});
    setDialog("create");
  };

  const openEdit = (office: { id: number; name: string; deskCount: number; employeeIds: number[]; deskAssignments: { employeeId: number; deskCode?: string | null }[] }) => {
    setForm({ name: office.name, deskCount: office.deskCount });
    setSelectedEmployees(new Set(office.employeeIds));
    const codes: Record<number, string> = {};
    for (const da of office.deskAssignments) {
      if (da.deskCode) codes[da.employeeId] = da.deskCode;
    }
    setDeskCodes(codes);
    setDialog(office.id);
  };

  const buildAssignments = () =>
    [...selectedEmployees].map((eid) => ({
      employeeId: eid,
      deskCode: deskCodes[eid] || null,
    }));

  const handleSave = () => {
    const assignments = buildAssignments();
    if (dialog === "create") {
      createOffice.mutate(
        { data: { name: form.name, deskCount: form.deskCount, employeeIds: assignments.map((a) => a.employeeId) } },
        {
          onSuccess: (office) => {
            if (assignments.length > 0) {
              updateOfficeEmployees.mutate(
                { id: office.id, data: { assignments } },
                {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getListOfficesQueryKey() });
                    setDialog(null);
                    toast({ title: "Office created" });
                  },
                }
              );
            } else {
              queryClient.invalidateQueries({ queryKey: getListOfficesQueryKey() });
              setDialog(null);
              toast({ title: "Office created" });
            }
          },
        }
      );
    } else if (typeof dialog === "number") {
      Promise.all([
        updateOffice.mutateAsync({ id: dialog, data: { name: form.name, deskCount: form.deskCount } }),
        updateOfficeEmployees.mutateAsync({ id: dialog, data: { assignments } }),
      ]).then(() => {
        queryClient.invalidateQueries({ queryKey: getListOfficesQueryKey() });
        setDialog(null);
        toast({ title: "Office updated" });
      });
    }
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Delete office "${name}"?`)) return;
    deleteOffice.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOfficesQueryKey() });
          toast({ title: "Office deleted" });
        },
      }
    );
  };

  const toggleEmployee = (id: number) => {
    const s = new Set(selectedEmployees);
    if (s.has(id)) {
      s.delete(id);
      const codes = { ...deskCodes };
      delete codes[id];
      setDeskCodes(codes);
    } else {
      s.add(id);
    }
    setSelectedEmployees(s);
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Offices</h1>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Office
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
          </div>
        ) : !offices || offices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Building2 className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-lg font-medium">No offices configured</p>
            <p className="text-sm">Add your first office to manage desk assignments</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {offices.map((office) => {
              const assignedEmployees = employees?.filter((e) => office.employeeIds.includes(e.id)) ?? [];
              return (
                <Card key={office.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{office.name}</CardTitle>
                        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                          <Building2 className="h-3.5 w-3.5" />
                          <span>{office.deskCount} desks</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(office)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(office.id, office.name)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground font-medium">
                      <Users className="h-3.5 w-3.5" />
                      {assignedEmployees.length} eligible employees
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {assignedEmployees.slice(0, 8).map((e) => {
                        const da = office.deskAssignments.find((d) => d.employeeId === e.id);
                        return (
                          <Badge key={e.id} variant="secondary" className="text-xs gap-1">
                            {e.name.split(" ")[0]}
                            {da?.deskCode && (
                              <span className="font-mono text-[10px] bg-background/50 px-1 rounded">{da.deskCode}</span>
                            )}
                          </Badge>
                        );
                      })}
                      {assignedEmployees.length > 8 && (
                        <Badge variant="outline" className="text-xs">+{assignedEmployees.length - 8} more</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{dialog === "create" ? "Add Office" : "Edit Office"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Office Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Number of Desks</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.deskCount}
                  onChange={(e) => setForm({ ...form, deskCount: parseInt(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Eligible Employees & Desk Codes</Label>
                <ScrollArea className="h-56 border rounded-lg">
                  <div className="p-3 space-y-2">
                    {employees?.map((emp) => (
                      <div key={emp.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`emp-${emp.id}`}
                          checked={selectedEmployees.has(emp.id)}
                          onCheckedChange={() => toggleEmployee(emp.id)}
                        />
                        <label htmlFor={`emp-${emp.id}`} className="text-sm cursor-pointer flex-1 min-w-0">
                          {emp.name}
                          <span className="text-muted-foreground ml-2 text-xs">{emp.country.toUpperCase()}</span>
                        </label>
                        {selectedEmployees.has(emp.id) && (
                          <Input
                            className="h-6 w-20 text-xs font-mono px-2"
                            placeholder="Desk code"
                            value={deskCodes[emp.id] ?? ""}
                            onChange={(e) => setDeskCodes({ ...deskCodes, [emp.id]: e.target.value })}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <p className="text-xs text-muted-foreground">{selectedEmployees.size} selected</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!form.name.trim()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
