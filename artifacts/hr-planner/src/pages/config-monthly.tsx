import { Layout } from "@/components/layout";
import {
  useListMonthlyConfigs,
  getListMonthlyConfigsQueryKey,
  useUpsertMonthlyConfig,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Save, CalendarDays } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEARS = [2025, 2026, 2027];

export default function MonthlyConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filterYear, setFilterYear] = useState(2026);
  const [editingMonth, setEditingMonth] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ contractualHours: number; jlDays: number }>({
    contractualHours: 160,
    jlDays: 0,
  });

  const { data: configs, isLoading } = useListMonthlyConfigs({
    query: { queryKey: getListMonthlyConfigsQueryKey() },
  });

  const upsertConfig = useUpsertMonthlyConfig();

  const yearConfigs = configs?.filter((c) => c.year === filterYear) ?? [];

  const getConfig = (month: number) =>
    yearConfigs.find((c) => c.month === month);

  const startEdit = (month: number) => {
    const config = getConfig(month);
    setEditingMonth(month);
    setEditForm({
      contractualHours: config?.contractualHours ?? 160,
      jlDays: config?.jlDays ?? 0,
    });
  };

  const handleSave = (month: number) => {
    upsertConfig.mutate(
      {
        year: filterYear,
        month,
        data: { contractualHours: editForm.contractualHours, jlDays: editForm.jlDays },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMonthlyConfigsQueryKey() });
          setEditingMonth(null);
          toast({ title: `${MONTH_NAMES[month - 1]} ${filterYear} saved` });
        },
      }
    );
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Monthly Configuration</h1>
          <div className="flex gap-2">
            {YEARS.map((y) => (
              <Button
                key={y}
                variant={filterYear === y ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterYear(y)}
              >
                {y}
              </Button>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground -mt-2">
          Configure contractual hours and the number of JL (CCT-FHL) days per month. The planner distributes JL days across employees so no two share the same date.
        </p>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
              const config = getConfig(month);
              const isEditing = editingMonth === month;
              const jlDays = config?.jlDays ?? 0;

              return (
                <Card key={month} className={isEditing ? "ring-2 ring-primary" : ""}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{MONTH_NAMES[month - 1]}</CardTitle>
                      {config ? (
                        <Badge variant="default" className="text-xs">Configured</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Not set</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isEditing ? (
                      <>
                        <div className="space-y-1">
                          <Label className="text-xs">Contractual Hours</Label>
                          <Input
                            type="number"
                            step="0.5"
                            value={editForm.contractualHours}
                            onChange={(e) => setEditForm({ ...editForm, contractualHours: parseFloat(e.target.value) })}
                            className="h-8 text-sm"
                            autoFocus
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">JL Days (CCT-FHL days to distribute)</Label>
                          <Input
                            type="number"
                            min={0}
                            max={5}
                            step={1}
                            value={editForm.jlDays}
                            onChange={(e) => setEditForm({ ...editForm, jlDays: parseInt(e.target.value, 10) || 0 })}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => handleSave(month)} disabled={upsertConfig.isPending}>
                            <Save className="h-3 w-3 mr-1" />
                            Save
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingMonth(null)}>
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-2xl font-bold">{config?.contractualHours ?? "—"}<span className="text-sm font-normal text-muted-foreground">h</span></div>
                        {jlDays > 0 && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarDays className="h-3 w-3" />
                            {jlDays} JL {jlDays === 1 ? "day" : "days"} to spread
                          </div>
                        )}
                        <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={() => startEdit(month)}>
                          Edit
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
