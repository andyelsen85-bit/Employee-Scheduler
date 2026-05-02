import { Link, useLocation } from "wouter";
import { Users, Calendar, Home, Building2, Clock, CalendarDays, CalendarRange, Shield, LogOut, Layers, DatabaseBackup, UserCheck, FileSpreadsheet, UserCog, Mail, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiLogout } from "@/hooks/use-auth";
import { useAuth } from "@/context/auth-context";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const ALL_NAV = [
  { name: "Dashboard", href: "/", icon: Home, adminOnly: true },
  { name: "Planning", href: "/planning", icon: Calendar, adminOnly: false },
  { name: "Permanence", href: `/permanence/${new Date().getFullYear()}`, icon: Shield, adminOnly: true },
  { name: "SPOC Rotation", href: `/spoc-rotation/${new Date().getFullYear()}`, icon: UserCheck, adminOnly: true },
  { name: "Employees", href: "/employees", icon: Users, adminOnly: true },
  { name: "Offices", href: "/config/offices", icon: Building2, adminOnly: true },
  { name: "Departments", href: "/config/departments", icon: Layers, adminOnly: true },
  { name: "Shift Codes", href: "/config/shift-codes", icon: Clock, adminOnly: true },
  { name: "Holidays", href: "/config/holidays", icon: CalendarDays, adminOnly: true },
  { name: "Monthly Config", href: "/config/monthly", icon: CalendarRange, adminOnly: true },
  { name: "Backup & Restore", href: "/config/backup", icon: DatabaseBackup, adminOnly: true },
  { name: "Excel Export / Import", href: "/config/excel", icon: FileSpreadsheet, adminOnly: true },
  { name: "Users", href: "/users", icon: UserCog, adminOnly: true },
  { name: "Mail Settings", href: "/config/mail", icon: Mail, adminOnly: true },
];

async function apiChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: "Failed to change password" }));
    throw new Error(e.error ?? "Failed to change password");
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";

  const [changePwOpen, setChangePwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);

  const navigation = ALL_NAV.filter(item => !item.adminOnly || isAdmin);

  const openChangePassword = () => {
    setPwForm({ current: "", next: "", confirm: "" });
    setChangePwOpen(true);
  };

  const handleChangePassword = async () => {
    if (pwForm.next !== pwForm.confirm) {
      toast({ title: "New passwords do not match", variant: "destructive" });
      return;
    }
    if (pwForm.next.length < 6) {
      toast({ title: "New password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setPwSaving(true);
    try {
      await apiChangePassword(pwForm.current, pwForm.next);
      toast({ title: "Password changed successfully" });
      setChangePwOpen(false);
    } catch (e: unknown) {
      toast({ title: String(e), variant: "destructive" });
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <div className="w-full md:w-64 bg-sidebar border-r border-sidebar-border text-sidebar-foreground flex flex-col h-16 md:h-screen sticky top-0">
        <div className="flex h-16 shrink-0 items-center px-6 font-bold tracking-tight text-lg border-b border-sidebar-border">
          HR Planner
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto py-4">
          <nav className="flex-1 space-y-1 px-3">
            {navigation.map((item) => {
              const basePath = item.href.startsWith("/permanence") ? "/permanence"
                : item.href.startsWith("/spoc-rotation") ? "/spoc-rotation"
                : item.href;
              const isActive = location === item.href || (basePath !== "/" && location.startsWith(basePath));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
          <div className="px-3 pb-2 space-y-1">
            {user && (
              <div className="px-3 py-1.5 text-xs text-sidebar-foreground/50 font-medium truncate">
                {user.username} ({user.role})
              </div>
            )}
            <button
              onClick={openChangePassword}
              className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-sidebar-accent/50 text-sidebar-foreground/60 hover:text-sidebar-foreground"
            >
              <KeyRound className="h-5 w-5 shrink-0" />
              Change Password
            </button>
            <button
              onClick={apiLogout}
              className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-sidebar-accent/50 text-sidebar-foreground/60 hover:text-sidebar-foreground"
            >
              <LogOut className="h-5 w-5 shrink-0" />
              Sign out
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </main>
      </div>

      <Dialog open={changePwOpen} onOpenChange={(open) => { if (!open) setChangePwOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Change Password
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Current Password</Label>
              <Input
                type="password"
                value={pwForm.current}
                onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <Input
                type="password"
                value={pwForm.next}
                onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm New Password</Label>
              <Input
                type="password"
                value={pwForm.confirm}
                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangePwOpen(false)}>Cancel</Button>
            <Button
              onClick={handleChangePassword}
              disabled={pwSaving || !pwForm.current.trim() || !pwForm.next.trim() || !pwForm.confirm.trim()}
            >
              {pwSaving ? "Saving..." : "Change Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
