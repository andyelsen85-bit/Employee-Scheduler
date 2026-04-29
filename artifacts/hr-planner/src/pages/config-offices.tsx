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
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, KeyboardEvent } from "react";
import { Plus, Pencil, Trash2, Building2, Users, KeyRound, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type OfficeForm = { name: string; deskCount: number; deskCodes: string[] };

export default function OfficesConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<null | "create" | number>(null);
  const [form, setForm] = useState<OfficeForm>({ name: "", deskCount: 10, deskCodes: [] });
  const [selectedEmployees, setSelectedEmployees] = useState<Set<number>>(new Set());
  const [newDeskCode, setNewDeskCode] = useState("");

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
    setForm({ name: "", deskCount: 10, deskCodes: [] });
    setSelectedEmployees(new Set());
    setNewDeskCode("");
    setDialog("create");
  };

  const openEdit = (office: { id: number; name: string; deskCount: number; deskCodes: string[]; employeeIds: number[] }) => {
    setForm({ name: office.name, deskCount: office.deskCount, deskCodes: [...office.deskCodes] });
    setSelectedEmployees(new Set(office.employeeIds));
    setNewDeskCode("");
    setDialog(office.id);
  };

  const addDeskCode = () => {
    const code = newDeskCode.trim().toUpperCase();
    if (!code || form.deskCodes.includes(code)) return;
    setForm({ ...form, deskCodes: [...form.deskCodes, code] });
    setNewDeskCode("");
  };

  const removeDeskCode = (code: string) => {
    setForm({ ...form, deskCodes: form.deskCodes.filter((c) => c !== code) });
  };

  const handleDeskCodeKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); addDeskCode(); }
    if (e.key === ",") { e.preventDefault(); addDeskCode(); }
  };

  const handleSave = async () => {
    const empIds = [...selectedEmployees];
    if (dialog === "create") {
      const office = await createOffice.mutateAsync({
        data: { name: form.name, deskCount: form.deskCount, deskCodes: form.deskCodes, employeeIds: empIds },
      });
      await updateOfficeEmployees.mutateAsync({ id: office.id, data: { employeeIds: empIds } });
    } else if (typeof dialog === "number") {
      await Promise.all([
        updateOffice.mutateAsync({ id: dialog, data: { name: form.name, deskCount: form.deskCount, deskCodes: form.deskCodes } }),
        updateOfficeEmployees.mutateAsync({ id: dialog, data: { employeeIds: empIds } }),
      ]);
    }
    queryClient.invalidateQueries({ queryKey: getListOfficesQueryKey() });
    setDialog(null);
    toast({ title: dialog === "create" ? "Office created" : "Office updated" });
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
    if (s.has(id)) s.delete(id);
    else s.add(id);
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
            <p className="text-sm">Add your first office to manage shared desks</p>
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
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5" />
                            {office.deskCount} desks
                          </span>
                          <span className="flex items-center gap-1">
                            <KeyRound className="h-3.5 w-3.5" />
                            {office.deskCodes.length} desk codes
                          </span>
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
                  <CardContent className="space-y-3">
                    {office.deskCodes.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
                          <KeyRound className="h-3 w-3" /> Shared desk pool
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {office.deskCodes.map((dc) => (
                            <Badge key={dc} variant="outline" className="font-mono text-[10px] px-1.5 h-5">{dc}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
                        <Users className="h-3 w-3" /> {assignedEmployees.length} employees
                      </p>
                      {assignedEmployees.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {assignedEmployees.map((e) => (
                            <span key={e.id} className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">{e.name}</span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground/50 italic">No employees assigned</p>
                      )}
                    </div>
                    <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={() => openEdit(office)}>
                      <Pencil className="h-3 w-3 mr-1" />
                      Edit office
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{dialog === "create" ? "Add Office" : "Edit Office"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Office Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Total Desks</Label>
                  <Input
                    type="number"
                    min="1"
                    value={form.deskCount}
                    onChange={(e) => setForm({ ...form, deskCount: parseInt(e.target.value) })}
                  />
                </div>
              </div>

              {/* Shared desk pool */}
              <div className="space-y-2">
                <Label>Shared Desk Pool</Label>
                <p className="text-xs text-muted-foreground">
                  Add desk codes for this office. The planner randomly assigns one per onsite day — the code appears in the planning grid.
                </p>
                <div className="flex gap-2">
                  <Input
                    className="font-mono"
                    placeholder="e.g. A-01"
                    value={newDeskCode}
                    onChange={(e) => setNewDeskCode(e.target.value.toUpperCase())}
                    onKeyDown={handleDeskCodeKeyDown}
                  />
                  <Button variant="outline" size="sm" onClick={addDeskCode} disabled={!newDeskCode.trim()}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                </div>
                {form.deskCodes.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 p-2 border rounded-md min-h-10">
                    {form.deskCodes.map((dc) => (
                      <span key={dc} className="inline-flex items-center gap-1 bg-muted rounded px-2 py-0.5 text-xs font-mono">
                        {dc}
                        <button onClick={() => removeDeskCode(dc)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/50 italic">No desk codes added yet</p>
                )}
              </div>

              {/* Employee assignment */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Eligible Employees</Label>
                  <span className="text-xs text-muted-foreground">{selectedEmployees.size} selected</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Select employees who can work from this office. The planner assigns them onsite days here.
                </p>
                <div className="border rounded-lg overflow-hidden">
                  <ScrollArea className="h-44">
                    <div className="divide-y">
                      {employees?.map((emp) => {
                        const isSelected = selectedEmployees.has(emp.id);
                        return (
                          <label
                            key={emp.id}
                            htmlFor={`emp-${emp.id}`}
                            className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/30"}`}
                          >
                            <Checkbox
                              id={`emp-${emp.id}`}
                              checked={isSelected}
                              onCheckedChange={() => toggleEmployee(emp.id)}
                            />
                            <span className="text-sm flex-1">{emp.name}</span>
                            <span className="text-xs text-muted-foreground">{emp.country.toUpperCase()}</span>
                          </label>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!form.name.trim() || createOffice.isPending || updateOffice.isPending}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
