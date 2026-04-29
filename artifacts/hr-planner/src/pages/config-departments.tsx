import { Layout } from "@/components/layout";
import {
  useListDepartments,
  getListDepartmentsQueryKey,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Plus, Pencil, Trash2, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type DeptForm = { name: string; order: number };

export default function DepartmentsConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<null | "create" | number>(null);
  const [form, setForm] = useState<DeptForm>({ name: "", order: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: departments, isLoading } = useListDepartments({
    query: { queryKey: getListDepartmentsQueryKey() },
  });

  const createDept = useCreateDepartment();
  const updateDept = useUpdateDepartment();
  const deleteDept = useDeleteDepartment();

  const openCreate = () => {
    setForm({ name: "", order: (departments?.length ?? 0) * 10 });
    setDialog("create");
  };

  const openEdit = (dept: { id: number; name: string; order: number }) => {
    setForm({ name: dept.name, order: dept.order });
    setDialog(dept.id);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      if (dialog === "create") {
        await createDept.mutateAsync({ data: { name: form.name.trim(), order: form.order } });
        toast({ title: "Department created" });
      } else if (typeof dialog === "number") {
        await updateDept.mutateAsync({ id: dialog, data: { name: form.name.trim(), order: form.order } });
        toast({ title: "Department updated" });
      }
      queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
      setDialog(null);
    } catch {
      toast({ title: "Error saving department", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteDept.mutateAsync({ id });
      toast({ title: "Department deleted" });
      queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey() });
    } catch {
      toast({ title: "Error deleting department", variant: "destructive" });
    }
    setDeleteConfirm(null);
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Departments</h1>
            <p className="text-muted-foreground text-sm mt-1">Organise employees into departments for better visibility in the planning view.</p>
          </div>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Department
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : departments?.length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
              <Layers className="h-10 w-10 opacity-30" />
              <p className="text-sm">No departments yet. Create one to start grouping employees.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {departments?.map(dept => (
              <Card key={dept.id} className="transition-colors hover:bg-muted/20">
                <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground min-w-[32px] text-center">{dept.order}</span>
                    <span className="font-semibold">{dept.name}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(dept)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteConfirm(dept.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Create / Edit dialog */}
        <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{dialog === "create" ? "New Department" : "Edit Department"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Operations"
                  onKeyDown={e => e.key === "Enter" && handleSave()}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Display order</Label>
                <Input
                  type="number"
                  value={form.order}
                  onChange={e => setForm(f => ({ ...f, order: parseInt(e.target.value) || 0 }))}
                />
                <p className="text-xs text-muted-foreground">Lower numbers appear first in the planning view.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!form.name.trim() || createDept.isPending || updateDept.isPending}>
                {dialog === "create" ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <Dialog open={deleteConfirm !== null} onOpenChange={open => { if (!open) setDeleteConfirm(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete department?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground py-2">Employees assigned to this department will become unassigned. This cannot be undone.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} disabled={deleteDept.isPending}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
