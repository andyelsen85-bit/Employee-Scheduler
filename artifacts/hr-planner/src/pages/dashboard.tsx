import { Layout } from "@/components/layout";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { format, startOfMonth, subMonths, addMonths } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, AlertTriangle, Users, Building, ShieldAlert, Shield } from "lucide-react";
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

  // Build employee name lookup from stats
  const empName = (id: number | null | undefined): string => {
    if (id == null) return "—";
    return (summary?.employeeStats as any[])?.find((e: any) => e.employeeId === id)?.name ?? `#${id}`;
  };

  const peakOnsite = summary?.dailyOnsiteRate && summary.dailyOnsiteRate.length > 0
    ? Math.max(...(summary.dailyOnsiteRate as any[]).map((d: any) => d.onsiteCount))
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : summary ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Planning Status</CardTitle>
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold capitalize">{(summary as any).planningStatus}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Violations</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${(summary as any).totalViolations > 0 ? "text-destructive" : ""}`}>
                    {(summary as any).totalViolations}
                  </div>
                  {(summary as any).totalViolations === 0 && (summary as any).planningStatus === "none" && (
                    <p className="text-xs text-muted-foreground mt-1">No planning generated</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{(summary as any).employeeStats.length}</div>
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
            </div>

            <div className="grid gap-6 md:grid-cols-2 flex-1 min-h-0">
              <Card className="flex flex-col">
                <CardHeader>
                  <CardTitle>Employee Stats</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-[400px]">
                    <div className="px-6 pb-6 space-y-4">
                      {(summary as any).employeeStats.map((stat: any) => (
                        <div key={stat.employeeId} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <div className="font-medium">{stat.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {stat.totalPlannedHours}h planned · {stat.plannedOnsiteDays}d onsite · {stat.plannedHomeworkDays}d HW · {stat.plannedCoworkDays}d CW
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Badge variant={stat.prmCounter < 0 ? "destructive" : "secondary"}>
                              PRM: {stat.prmCounter > 0 ? "+" : ""}{stat.prmCounter}h
                            </Badge>
                            <Badge variant="outline">Hol: {stat.holidayHoursRemaining}h</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Permanence — {format(currentDate, "MMMM yyyy")}</CardTitle>
                  <Shield className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-[400px]">
                    <div className="px-6 pb-6 space-y-3">
                      {(summary as any).permanenceSchedule?.length === 0 && (
                        <p className="text-sm text-muted-foreground py-4">No permanence assignments for this month.</p>
                      )}
                      {(summary as any).permanenceSchedule?.map((week: any) => (
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
            </div>

            {/* Violations detail */}
            {(summary as any).violations?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-destructive flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Violation Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {(summary as any).violations.map((v: any, i: number) => (
                      <li key={i} className="flex gap-2 items-start">
                        <span className="text-destructive font-mono text-xs mt-0.5 shrink-0">{v.date}</span>
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
