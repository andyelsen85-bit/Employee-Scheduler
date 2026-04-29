import { Layout } from "@/components/layout";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { format, startOfMonth, subMonths, addMonths } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, AlertTriangle, Users, Building, ShieldAlert } from "lucide-react";
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
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.employeeStats.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Peak On-site Days</CardTitle>
                  <Building className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {summary.dailyOnsiteRate && summary.dailyOnsiteRate.length > 0 
                      ? Math.max(...summary.dailyOnsiteRate.map((d: any) => d.onsiteCount))
                      : 0}
                  </div>
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
                      {summary.employeeStats.map((stat: any) => (
                        <div key={stat.employeeId} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <div className="font-medium">{stat.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {stat.totalPlannedHours}h planned
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Badge variant={stat.prmCounter < 0 ? "destructive" : "secondary"}>
                              PRM: {stat.prmCounter}
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
                <CardHeader>
                  <CardTitle>Permanence Schedule</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-[400px]">
                    <div className="px-6 pb-6 space-y-4">
                      {summary.permanenceSchedule.map((week: any, i: number) => (
                        <div key={i} className="border rounded-lg p-4">
                          <div className="text-sm font-medium mb-3 text-muted-foreground">
                            Week: {format(new Date(week.weekStart), "MMM d")} - {format(new Date(week.weekEnd), "MMM d")}
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-xs font-semibold mb-1">Group 1</div>
                              <div className="text-sm">L1: {summary.employeeStats.find((e: any) => e.employeeId === week.group1Level1EmployeeId)?.name || "—"}</div>
                              <div className="text-sm">L2: {summary.employeeStats.find((e: any) => e.employeeId === week.group1Level2EmployeeId)?.name || "—"}</div>
                            </div>
                            <div>
                              <div className="text-xs font-semibold mb-1">Group 2</div>
                              <div className="text-sm">L1: {summary.employeeStats.find((e: any) => e.employeeId === week.group2Level1EmployeeId)?.name || "—"}</div>
                              <div className="text-sm">L2: {summary.employeeStats.find((e: any) => e.employeeId === week.group2Level2EmployeeId)?.name || "—"}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
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