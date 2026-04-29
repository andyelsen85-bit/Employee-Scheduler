import { Layout } from "@/components/layout";
import {
  useListHolidays,
  getListHolidaysQueryKey,
  useCreateHoliday,
  useUpdateHoliday,
  useDeleteHoliday,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Plus, Pencil, Trash2, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const YEARS = [2025, 2026, 2027];
const DEFAULT_FORM = { date: "", name: "", country: "lu" };

export default function HolidaysConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filterYear, setFilterYear] = useState(2026);
  const [dialog, setDialog] = useState<null | "create" | number>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editId, setEditId] = useState<number | null>(null);

  const { data: holidays, isLoading } = useListHolidays(
    { year: filterYear },
    { query: { queryKey: getListHolidaysQueryKey({ year: filterYear }) } }
  );

  const createHoliday = useCreateHoliday();
  const updateHoliday = useUpdateHoliday();
  const deleteHoliday = useDeleteHoliday();

  const openCreate = () => {
    setForm({ ...DEFAULT_FORM, date: `${filterYear}-01-01` });
    setEditId(null);
    setDialog("create");
  };

  const openEdit = (h: { id: number; date: string; name: string; country: string }) => {
    setForm({ date: h.date, name: h.name, country: h.country });
    setEditId(h.id);
    setDialog(h.id);
  };

  const handleSave = () => {
    if (editId === null) {
      createHoliday.mutate(
        { data: { date: form.date, name: form.name, country: form.country } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListHolidaysQueryKey({ year: filterYear }) });
            setDialog(null);
            toast({ title: "Holiday added" });
          },
        }
      );
    } else {
      updateHoliday.mutate(
        { id: editId, data: { date: form.date, name: form.name, country: form.country } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListHolidaysQueryKey({ year: filterYear }) });
            setDialog(null);
            toast({ title: "Holiday updated" });
          },
        }
      );
    }
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    deleteHoliday.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListHolidaysQueryKey({ year: filterYear }) });
          toast({ title: "Holiday deleted" });
        },
      }
    );
  };

  const byMonth = holidays?.reduce(
    (acc, h) => {
      const month = h.date.slice(0, 7);
      if (!acc[month]) acc[month] = [];
      acc[month].push(h);
      return acc;
    },
    {} as Record<string, typeof holidays>
  );

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Public Holidays</h1>
          <div className="flex gap-2">
            <Select value={String(filterYear)} onValueChange={(v) => setFilterYear(Number(v))}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add Holiday
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : !holidays || holidays.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Calendar className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-lg font-medium">No holidays for {filterYear}</p>
          </div>
        ) : (
          <div className="border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-mono text-sm">
                      {format(new Date(h.date + "T12:00:00"), "EEE, d MMM yyyy")}
                    </TableCell>
                    <TableCell className="font-medium">{h.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{h.country.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(h)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(h.id, h.name)}>
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
              <DialogTitle>{editId === null ? "Add Holiday" : "Edit Holiday"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lu">Luxembourg</SelectItem>
                    <SelectItem value="be">Belgium</SelectItem>
                    <SelectItem value="de">Germany</SelectItem>
                    <SelectItem value="fr">France</SelectItem>
                    <SelectItem value="all">All Countries</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!form.name.trim() || !form.date}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
