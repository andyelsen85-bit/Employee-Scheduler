import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import { AuthProvider, useAuth } from "@/context/auth-context";

import Dashboard from "@/pages/dashboard";
import Planning from "@/pages/planning";
import Employees from "@/pages/employees";
import EmployeeDetail from "@/pages/employee-detail";
import OfficesConfig from "@/pages/config-offices";
import DepartmentsConfig from "@/pages/config-departments";
import ShiftCodesConfig from "@/pages/config-shift-codes";
import HolidaysConfig from "@/pages/config-holidays";
import MonthlyConfig from "@/pages/config-monthly";
import Permanence from "@/pages/permanence";
import BackupRestore from "@/pages/config-backup";
import ExcelExportImport from "@/pages/config-excel";
import SpocRotation from "@/pages/spoc-rotation";
import UsersPage from "@/pages/users";
import MailSettingsPage from "@/pages/config-mail";

const queryClient = new QueryClient();

function AdminRoutes() {
  return (
    <>
      <Route path="/" component={Dashboard} />
      <Route path="/employees" component={Employees} />
      <Route path="/employees/:id" component={EmployeeDetail} />
      <Route path="/config/offices" component={OfficesConfig} />
      <Route path="/config/departments" component={DepartmentsConfig} />
      <Route path="/config/shift-codes" component={ShiftCodesConfig} />
      <Route path="/config/holidays" component={HolidaysConfig} />
      <Route path="/config/monthly" component={MonthlyConfig} />
      <Route path="/permanence/:year" component={Permanence} />
      <Route path="/config/backup" component={BackupRestore} />
      <Route path="/config/excel" component={ExcelExportImport} />
      <Route path="/spoc-rotation/:year" component={SpocRotation} />
      <Route path="/users" component={UsersPage} />
      <Route path="/config/mail" component={MailSettingsPage} />
    </>
  );
}

function Router() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <Switch>
      <Route path="/planning">
        {() => {
          const date = new Date();
          return <Redirect to={`/planning/${date.getFullYear()}/${date.getMonth() + 1}`} />;
        }}
      </Route>
      <Route path="/planning/:year/:month" component={Planning} />
      {isAdmin && <AdminRoutes />}
      {!isAdmin && <Route path="/">
        {() => {
          const date = new Date();
          return <Redirect to={`/planning/${date.getFullYear()}/${date.getMonth() + 1}`} />;
        }}
      </Route>}
      <Route component={NotFound} />
    </Switch>
  );
}

function AppInner() {
  const { user, loading, setUser } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-white text-sm">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Login onSuccess={(u) => setUser(u)} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

export default App;
