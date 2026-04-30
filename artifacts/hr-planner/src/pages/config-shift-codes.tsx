import { Layout } from "@/components/layout";
import {
  useListShiftCodes,
  getListShiftCodesQueryKey,
  useCreateShiftCode,
  useUpdateShiftCode,
  useDeleteShiftCode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SHIFT_TYPE_COLORS: Record<string, string> = {
  onsite: "bg-blue-500/15 text-blue-700 border-blue-500/20",
  homework: "bg-green-500/15 text-green-700 border-green-500/20",
  cowork: "bg-amber-500/15 text-amber-700 border-amber-500/20",
  holiday: "bg-red-500/15 text-red-700 border-red-500/20",
  jl: "bg-purple-500/15 text-purple-700 border-purple-500/20",
};

const DEFAULT_FORM = { code: "", label: "", hours: 8, type: "onsite", isActive: true, color: "" };

export default function ShiftCodesConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<null | "create" | { code: string; label: string; hours: number; type: string; isActive: boolean; color?: string | null }>(null);
  const [form, setForm] = useState(DEFAULT_FORM);

  const { data: shiftCodes, isLoading } = useListShiftCodes({
    query: { queryKey: getListShiftCodesQueryKey() },
  });
  const createShiftCode = useCreateShiftCode();
  const updateShiftCode = useUpdateShiftCode();
  const deleteShiftCode = useDeleteShiftCode();

  const openCreate = () => {
    setForm(DEFAULT_FORM);
    setDialog("create");
  };

  type ShiftCode = { code: string; label: string; hours: number; type: string; isActive: boolean; color?: string | null };

  const openEdit = (sc: ShiftCode) => {
    setForm({ code: sc.code, label: sc.label, hours: sc.hours, type: sc.type, isActive: sc.isActive, color: sc.color ?? "" });
    setDialog(sc);
  };

  const handleSave = () => {
    if (dialog === "create") {
      createShiftCode.mutate(
        { data: { code: form.code, label: form.label, hours: form.hours, type: form.type, isActive: form.isActive, color: form.color || null } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListShiftCodesQueryKey() });
            setDialog(null);
            toast({ title: "Shift code created" });
          },
        }
      );
    } else if (dialog) {
      updateShiftCode.mutate(
        { code: (dialog as { code: string }).code, data: { label: form.label, hours: form.hours, type: form.type, isActive: form.isActive, color: form.color || null } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListShiftCodesQueryKey() });
            setDialog(null);
            toast({ title: "Shift code updated" });
          },
        }
      );
    }
  };

  const handleDelete = (code: string) => {
    if (!confirm(`Delete shift code ${code}?`)) return;
    deleteShiftCode.mutate(
      { code },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListShiftCodesQueryKey() });
          toast({ title: "Shift code deleted" });
        },
      }
    );
  };

  const groupedCodes = shiftCodes?.reduce(
    (acc, sc) => {
      if (!acc[sc.type]) acc[sc.type] = [];
      acc[sc.type].push(sc);
      return acc;
    },
    {} as Record<string, typeof shiftCodes>
  );

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Shift Codes</h1>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Code
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shiftCodes?.map((sc) => (
                  <TableRow key={sc.code}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {sc.color ? (
                          <span
                            className="inline-block h-3.5 w-3.5 rounded-full border border-black/10 flex-shrink-0"
                            style={{ backgroundColor: sc.color }}
                            title={sc.color}
                          />
                        ) : (
                          <span className="inline-block h-3.5 w-3.5 rounded-full border border-dashed border-muted-foreground/30 flex-shrink-0" />
                        )}
                        <span className="font-mono font-semibold">{sc.code}</span>
                      </div>
                    </TableCell>
                    <TableCell>{sc.label}</TableCell>
                    <TableCell>
                      <Badge className={`capitalize border ${SHIFT_TYPE_COLORS[sc.type] ?? ""}`}>
                        {sc.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{sc.hours}h</TableCell>
                    <TableCell>
                      <Badge variant={sc.isActive ? "default" : "secondary"}>
                        {sc.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(sc)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(sc.code)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialog === "create" ? "Add Shift Code" : "Edit Shift Code"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  disabled={dialog !== "create"}
                  className="font-mono"
                  maxLength={8}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Label</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="onsite">Onsite</SelectItem>
                      <SelectItem value="homework">Homework</SelectItem>
                      <SelectItem value="cowork">Cowork</SelectItem>
                      <SelectItem value="holiday">Holiday</SelectItem>
                      <SelectItem value="jl">JL (CCT-FHL)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Hours</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={form.hours}
                    onChange={(e) => setForm({ ...form, hours: parseFloat(e.target.value) })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              </div>
              <div className="space-y-1.5">
                <Label>Custom Color <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.color || "#3b82f6"}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="h-9 w-16 cursor-pointer rounded border border-input p-0.5"
                  />
                  <span className="text-sm text-muted-foreground font-mono">{form.color || "(type default)"}</span>
                  {form.color && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => setForm({ ...form, color: "" })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Overrides the default type-based color in the planning view.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button onClick={handleSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
