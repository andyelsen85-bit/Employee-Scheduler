import { Layout } from "@/components/layout";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, UserCog, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useListEmployees, getListEmployeesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type UserRecord = {
  id: number;
  username: string;
  role: string;
  employeeId: number | null;
  isLegacy: boolean;
};

async function fetchUsers(): Promise<UserRecord[]> {
  const res = await fetch("/api/users", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

async function createUser(data: { username: string; password: string; role: string; employeeId: number | null }): Promise<UserRecord> {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: "Failed to create user" }));
    throw new Error(e.error ?? "Failed to create user");
  }
  return res.json();
}

async function updateUser(id: number, data: Partial<{ username: string; password: string; role: string; employeeId: number | null }>): Promise<UserRecord> {
  const res = await fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: "Failed to update user" }));
    throw new Error(e.error ?? "Failed to update user");
  }
  return res.json();
}

async function deleteUser(id: number): Promise<void> {
  const res = await fetch(`/api/users/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error("Failed to delete user");
}

type EditForm = {
  username: string;
  password: string;
  role: string;
  employeeId: string;
};

export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [form, setForm] = useState<EditForm>({ username: "", password: "", role: "user", employeeId: "none" });
  const [saving, setSaving] = useState(false);

  const { data: employees } = useListEmployees({ query: { queryKey: getListEmployeesQueryKey() } });

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchUsers();
      setUsers(rows);
    } catch (e: unknown) {
      toast({ title: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm({ username: "", password: "", role: "user", employeeId: "none" });
    setCreating(true);
  };

  const openEdit = (u: UserRecord) => {
    setForm({ username: u.username, password: "", role: u.role, employeeId: u.employeeId ? String(u.employeeId) : "none" });
    setEditing(u);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        username: form.username,
        role: form.role,
        employeeId: form.employeeId === "none" ? null : Number(form.employeeId),
        ...(form.password ? { password: form.password } : {}),
      };
      if (creating) {
        if (!form.password) { toast({ title: "Password is required", variant: "destructive" }); return; }
        await createUser({ ...payload, password: form.password });
        toast({ title: "User created" });
      } else if (editing) {
        await updateUser(editing.id, payload);
        toast({ title: "User updated" });
      }
      await load();
      queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
      setCreating(false);
      setEditing(null);
    } catch (e: unknown) {
      toast({ title: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: UserRecord) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      await deleteUser(u.id);
      toast({ title: "User deleted" });
      await load();
    } catch (e: unknown) {
      toast({ title: String(e), variant: "destructive" });
    }
  };

  const employeeNameMap = new Map<number, string>(employees?.map(e => [e.id, e.name]) ?? []);

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground">
            <UserCog className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-lg font-medium">No users found</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {users.map(u => (
              <Card key={u.id} className="hover:bg-muted/20 transition-colors">
                <CardContent className="flex items-center justify-between py-3 px-6">
                  <div className="flex items-center gap-4">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary text-sm">
                      {u.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{u.username}</span>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs">{u.role}</Badge>
                        {u.isLegacy && <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">legacy pwd</Badge>}
                      </div>
                      {u.employeeId && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Linked to: {employeeNameMap.get(u.employeeId) ?? `Employee #${u.employeeId}`}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(u)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={creating || !!editing} onOpenChange={(open) => { if (!open) { setCreating(false); setEditing(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                {creating ? "Add User" : "Edit User"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="johndoe" />
              </div>
              <div className="space-y-1.5">
                <Label>{creating ? "Password" : "New Password (leave blank to keep current)"}</Label>
                <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Linked Employee (optional)</Label>
                <Select value={form.employeeId} onValueChange={v => setForm(f => ({ ...f, employeeId: v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent style={{ maxHeight: "20rem" }}>
                    <SelectItem value="none">None</SelectItem>
                    {employees?.map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Links this login account to an employee record (needed for shift demands).</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.username.trim()}>
                {saving ? "Saving..." : creating ? "Create User" : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
