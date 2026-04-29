import { Layout } from "@/components/layout";
import { Link } from "wouter";
import {
  useListEmployees,
  getListEmployeesQueryKey,
  useCreateEmployee,
  useDeleteEmployee,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Plus, Search, Pencil, Trash2, User, ShieldCheck, Crown } from "lucide-react";
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

  const { data: employees, isLoading } = useListEmployees({
    query: { queryKey: getListEmployeesQueryKey() },
  });

  const createEmployee = useCreateEmployee();
  const deleteEmployee = useDeleteEmployee();

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

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Employees</h1>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Employee
          </Button>
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
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary text-sm">
                      {emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{emp.name}</span>
                        <Badge variant="outline" className="text-xs">{COUNTRY_FLAGS[emp.country] ?? emp.country.toUpperCase()}</Badge>
                        {emp.isSpoc && <Badge className="text-xs"><ShieldCheck className="h-3 w-3 mr-1" />SPOC</Badge>}
                        {emp.isManagement && <Badge variant="secondary" className="text-xs"><Crown className="h-3 w-3 mr-1" />Mgmt</Badge>}
                        {emp.permanenceGroup && (
                          <Badge variant="outline" className="text-xs">
                            G{emp.permanenceGroup}/L{emp.permanenceLevel}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
                        <span>PRM: <span className={emp.prmCounter < 0 ? "text-destructive font-medium" : ""}>{emp.prmCounter.toFixed(1)}h</span></span>
                        <span>Holiday: {emp.holidayHoursRemaining.toFixed(1)}h</span>
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
      </div>
    </Layout>
  );
}
