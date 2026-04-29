import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import Planning from "@/pages/planning";
import Employees from "@/pages/employees";
import EmployeeDetail from "@/pages/employee-detail";
import OfficesConfig from "@/pages/config-offices";
import ShiftCodesConfig from "@/pages/config-shift-codes";
import HolidaysConfig from "@/pages/config-holidays";
import MonthlyConfig from "@/pages/config-monthly";
import Permanence from "@/pages/permanence";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/planning">
        {() => {
          const date = new Date();
          return <Redirect to={`/planning/${date.getFullYear()}/${date.getMonth() + 1}`} />;
        }}
      </Route>
      <Route path="/planning/:year/:month" component={Planning} />
      <Route path="/employees" component={Employees} />
      <Route path="/employees/:id" component={EmployeeDetail} />
      <Route path="/config/offices" component={OfficesConfig} />
      <Route path="/config/shift-codes" component={ShiftCodesConfig} />
      <Route path="/config/holidays" component={HolidaysConfig} />
      <Route path="/config/monthly" component={MonthlyConfig} />
      <Route path="/permanence/:year" component={Permanence} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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

export default App;