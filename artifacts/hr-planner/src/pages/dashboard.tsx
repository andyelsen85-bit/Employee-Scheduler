import { Layout } from "@/components/layout";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { format, subMonths, addMonths } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, AlertTriangle, Building, ShieldAlert, Shield, CalendarX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function Dashboard() {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  const { data: summary, isLoading } = useGetDashboardSummary(
    { year, month },
    { query: { queryKey: getGetDashboardSummaryQueryKey({ year, month }) } }
  );

  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));

  const empName = (id: number | null | undefined): string => {
    if (id == null) return "—";
    const stat = summary?.employeeStats.find((e) => e.employeeId === id);
    return stat?.name ?? `#${id}`;
  };

  const peakOnsite = summary?.dailyOnsiteRate && summary.dailyOnsiteRate.length > 0
    ? Math.max(...summary.dailyOnsiteRate.map((d) => d.onsiteCount))
    : 0;

  return (
    <Layout>
      <div className="flex flex-col gap-6 h-full">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>

          <div className="flex items-center gap-4 bg-card border rounded-lg p-1">
            <Button variant="ghost" size="icon" onClick={prevMonth} className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="font-medium text-sm w-32 text-center">
              {format(currentDate, "MMMM yyyy")}
            </div>
            <Button variant="ghost" size="icon" onClick={nextMonth} className="h-8 w-8">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : summary ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Planning Status</CardTitle>
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold capitalize">{summary.planningStatus}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Violations</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${summary.totalViolations > 0 ? "text-destructive" : ""}`}>
                    {summary.totalViolations}
                  </div>
                  {summary.totalViolations === 0 && summary.planningStatus === "none" && (
                    <p className="text-xs text-muted-foreground mt-1">No planning generated</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Peak On-Site Day</CardTitle>
                  <Building className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{peakOnsite}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Max employees on-site on any single day
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Negative Holiday Balances</CardTitle>
                  <CalendarX className={`h-4 w-4 ${summary.negativeHolidayBalanceCount > 0 ? "text-destructive" : "text-muted-foreground"}`} />
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${summary.negativeHolidayBalanceCount > 0 ? "text-destructive" : ""}`}>
                    {summary.negativeHolidayBalanceCount}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {summary.negativeHolidayBalanceCount === 0
                      ? "All holiday balances are non-negative"
                      : `${summary.negativeHolidayBalanceCount === 1 ? "Employee" : "Employees"} with at least one balance below zero`}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="flex flex-col flex-1 min-h-0">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Permanence — {format(currentDate, "MMMM yyyy")}</CardTitle>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-[400px]">
                  <div className="px-6 pb-6 space-y-3">
                    {summary.permanenceSchedule.length === 0 && (
                      <p className="text-sm text-muted-foreground py-4">No permanence assignments for this month.</p>
                    )}
                    {summary.permanenceSchedule.map((week) => (
                      <div key={week.weekNumber} className="border rounded-lg p-3">
                        <div className="text-xs font-semibold text-muted-foreground mb-2">
                          W{week.weekNumber} · {format(new Date(week.weekStart), "MMM d")} – {format(new Date(week.weekEnd), "MMM d")}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">G1</span>
                            <span className="text-sm font-medium">
                              {empName(week.g1EmployeeId)}
                            </span>
                            {week.g1Manual && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0">manual</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-purple-600 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">G2</span>
                            <span className="text-sm font-medium">
                              {empName(week.g2EmployeeId)}
                            </span>
                            {week.g2Manual && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0">manual</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Violations detail */}
            {summary.violations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-destructive flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Violation Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {summary.violations.map((v, i) => (
                      <li key={i} className="flex gap-2 items-start">
                        <span className="text-destructive font-mono text-xs mt-0.5 shrink-0">{v.type}</span>
                        <span>{v.message}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            No data available for this month
          </div>
        )}
      </div>
    </Layout>
  );
}
