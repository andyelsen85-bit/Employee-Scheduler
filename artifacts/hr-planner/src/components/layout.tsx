import { Link, useLocation } from "wouter";
import { Users, Calendar, Home, Building2, Clock, CalendarDays, CalendarRange, Shield, LogOut, Layers, DatabaseBackup, UserCheck, FileSpreadsheet, UserCog, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiLogout } from "@/hooks/use-auth";
import { useAuth } from "@/context/auth-context";

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

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const navigation = ALL_NAV.filter(item => !item.adminOnly || isAdmin);

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
    </div>
  );
}
