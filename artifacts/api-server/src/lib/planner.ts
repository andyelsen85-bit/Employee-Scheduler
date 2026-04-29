import { addDays, format, getDay, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";

export type ShiftCodeRecord = {
  code: string;
  hours: number;
  type: string;
};

export type EmployeeRecord = {
  id: number;
  country: string;
  contractPercent: number;
  weeklyContractHours: number;
  homeworkEligible: boolean;
  coworkEligible: boolean;
  allowedShiftCodes: string[];
  permanenceGroup: number | null;
  permanenceLevel: number | null;
  isSpoc: boolean;
  isManagement: boolean;
  prmCounter: number;
  homeworkDaysUsedThisYear: number;
};

export type OfficeRecord = {
  id: number;
  deskCount: number;
  employeeIds: number[];
};

export type WeekTemplateRecord = {
  id: number;
  employeeId: number;
  days: Array<{ dayOfWeek: number; shiftCode: string | null }>;
};

export type RequestedDayOff = {
  employeeId: number;
  dates: string[];
};

export type PlanningEntryInput = {
  employeeId: number;
  date: string;
  shiftCode: string | null;
  isPermanence: boolean;
  permanenceLevel: number | null;
  isLocked: boolean;
  requestedOff: boolean;
};

export type PlanningViolation = {
  date: string;
  type: string;
  message: string;
  employeeId: number | null;
};

const HOMEWORK_DAY_LIMIT = 35;
const PRM_MAX = 10;
const PRM_MIN = -10;
const HOLIDAY_HOURS = 7.6;

function getWorkingDays(year: number, month: number, publicHolidayDates: string[]): string[] {
  const start = startOfMonth(new Date(year, month - 1));
  const end = endOfMonth(new Date(year, month - 1));
  const days = eachDayOfInterval({ start, end });

  const blockedSet = new Set(publicHolidayDates);

  return days
    .filter((d) => {
      const dow = getDay(d);
      const iso = format(d, "yyyy-MM-dd");
      return dow !== 0 && dow !== 6 && !blockedSet.has(iso);
    })
    .map((d) => format(d, "yyyy-MM-dd"));
}

function getDayOfWeek0Mon(dateStr: string): number {
  const d = parseISO(dateStr);
  const dow = getDay(d);
  return dow === 0 ? 6 : dow - 1;
}

function getWeekNumber(dateStr: string): string {
  const d = parseISO(dateStr);
  const monday = addDays(d, -(getDayOfWeek0Mon(dateStr)));
  return format(monday, "yyyy-MM-dd");
}

function bestOnsiteCode(allowed: string[], shiftCodes: Record<string, ShiftCodeRecord>): string | null {
  const priority = ["X82", "X81", "X80", "X79", "X78"];
  for (const c of priority) {
    if (allowed.includes(c) && shiftCodes[c]) return c;
  }
  return null;
}

function bestHomeworkCode(allowed: string[], shiftCodes: Record<string, ShiftCodeRecord>): string | null {
  const priority = ["TT9", "TT8", "TT6", "TT4", "TT2"];
  for (const c of priority) {
    if (allowed.includes(c) && shiftCodes[c]) return c;
  }
  return null;
}

function bestCoworkCode(allowed: string[], shiftCodes: Record<string, ShiftCodeRecord>): string | null {
  const priority = ["CW9", "CW8", "CW6", "CW4"];
  for (const c of priority) {
    if (allowed.includes(c) && shiftCodes[c]) return c;
  }
  return null;
}

function hoursForCode(code: string | null, shiftCodes: Record<string, ShiftCodeRecord>): number {
  if (!code) return 0;
  return shiftCodes[code]?.hours ?? 0;
}

function isOnsiteCode(code: string | null, shiftCodes: Record<string, ShiftCodeRecord>): boolean {
  if (!code) return false;
  return shiftCodes[code]?.type === "onsite";
}

function isHomeworkCode(code: string | null, shiftCodes: Record<string, ShiftCodeRecord>): boolean {
  if (!code) return false;
  return shiftCodes[code]?.type === "homework";
}

function isCoworkCode(code: string | null, shiftCodes: Record<string, ShiftCodeRecord>): boolean {
  if (!code) return false;
  return shiftCodes[code]?.type === "cowork";
}

/**
 * Distribute jlDays JL shifts per employee across working days.
 * Constraint: no two employees share the same JL date.
 * Strategy: for each employee (in order), greedily pick days with the lowest
 * current JL occupancy, spreading assignments across the month.
 */
function distributeJlDays(
  employees: EmployeeRecord[],
  workingDays: string[],
  jlDays: number
): Record<number, Set<string>> {
  const jlAssignments: Record<number, Set<string>> = {};
  const jlCountByDate: Record<string, number> = {};
  for (const d of workingDays) jlCountByDate[d] = 0;

  for (const emp of employees) {
    jlAssignments[emp.id] = new Set();
    if (jlDays <= 0 || workingDays.length === 0) continue;

    const count = Math.min(jlDays, workingDays.length);

    const sortedDays = [...workingDays].sort((a, b) => {
      const diff = (jlCountByDate[a] ?? 0) - (jlCountByDate[b] ?? 0);
      if (diff !== 0) return diff;
      return a < b ? -1 : 1;
    });

    const picked = sortedDays.slice(0, count);
    for (const d of picked) {
      jlAssignments[emp.id].add(d);
      jlCountByDate[d] = (jlCountByDate[d] ?? 0) + 1;
    }
  }

  return jlAssignments;
}

export function generatePlanning(params: {
  year: number;
  month: number;
  employees: EmployeeRecord[];
  offices: OfficeRecord[];
  shiftCodes: Record<string, ShiftCodeRecord>;
  templates: WeekTemplateRecord[];
  publicHolidayDates: string[];
  jlDays: number;
  contractualHours: number;
  requestedDaysOff: RequestedDayOff[];
}): { entries: PlanningEntryInput[]; violations: PlanningViolation[] } {
  const {
    year,
    month,
    employees,
    offices,
    shiftCodes,
    templates,
    publicHolidayDates,
    jlDays,
    contractualHours,
    requestedDaysOff,
  } = params;

  const workingDays = getWorkingDays(year, month, publicHolidayDates);
  const allDays = eachDayOfInterval({
    start: startOfMonth(new Date(year, month - 1)),
    end: endOfMonth(new Date(year, month - 1)),
  }).map((d) => format(d, "yyyy-MM-dd"));

  const requestedOffMap: Record<number, Set<string>> = {};
  for (const r of requestedDaysOff) {
    requestedOffMap[r.employeeId] = new Set(r.dates);
  }

  const templatesByEmployee: Record<number, WeekTemplateRecord[]> = {};
  for (const t of templates) {
    if (!templatesByEmployee[t.employeeId]) templatesByEmployee[t.employeeId] = [];
    templatesByEmployee[t.employeeId].push(t);
  }

  const permanenceGroup1L1 = employees.filter((e) => e.permanenceGroup === 1 && e.permanenceLevel === 1);
  const permanenceGroup1L2 = employees.filter((e) => e.permanenceGroup === 1 && e.permanenceLevel === 2);
  const permanenceGroup2L1 = employees.filter((e) => e.permanenceGroup === 2 && e.permanenceLevel === 1);
  const permanenceGroup2L2 = employees.filter((e) => e.permanenceGroup === 2 && e.permanenceLevel === 2);

  const weekStarts = [...new Set(workingDays.map(getWeekNumber))];

  const permanenceAssignments: Record<string, { g1l1: number | null; g1l2: number | null; g2l1: number | null; g2l2: number | null }> = {};

  function rotateAssign(group: EmployeeRecord[], weekIdx: number): number | null {
    if (group.length === 0) return null;
    return group[weekIdx % group.length].id;
  }

  weekStarts.forEach((ws, idx) => {
    permanenceAssignments[ws] = {
      g1l1: rotateAssign(permanenceGroup1L1, idx),
      g1l2: rotateAssign(permanenceGroup1L2, idx),
      g2l1: rotateAssign(permanenceGroup2L1, idx),
      g2l2: rotateAssign(permanenceGroup2L2, idx),
    };
  });

  const jlAssignments = distributeJlDays(employees, workingDays, jlDays);

  const onsiteCountByDate: Record<string, Set<number>> = {};
  for (const d of allDays) onsiteCountByDate[d] = new Set();

  const homeworkCountThisMonth: Record<number, number> = {};
  const plannedHoursByEmployee: Record<number, number> = {};
  for (const e of employees) {
    homeworkCountThisMonth[e.id] = 0;
    plannedHoursByEmployee[e.id] = 0;
  }

  const entries: PlanningEntryInput[] = [];

  const templateRotation: Record<number, number> = {};
  for (const e of employees) templateRotation[e.id] = 0;

  for (const dateStr of allDays) {
    const dayOfWeek = getDayOfWeek0Mon(dateStr);
    const weekStart = getWeekNumber(dateStr);
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    const isPublicHoliday = publicHolidayDates.includes(dateStr);

    for (const emp of employees) {
      const requestedOff = requestedOffMap[emp.id]?.has(dateStr) ?? false;
      const permaInfo = permanenceAssignments[weekStart];
      const isPermanenceL1 =
        (permaInfo?.g1l1 === emp.id) || (permaInfo?.g2l1 === emp.id);
      const isPermanenceL2 =
        (permaInfo?.g1l2 === emp.id) || (permaInfo?.g2l2 === emp.id);
      const isPermanence = isPermanenceL1 || isPermanenceL2;
      const permanenceLevel = isPermanenceL1 ? 1 : isPermanenceL2 ? 2 : null;

      if (isWeekend) {
        continue;
      }

      if (isPublicHoliday) {
        entries.push({
          employeeId: emp.id,
          date: dateStr,
          shiftCode: "C0",
          isPermanence: false,
          permanenceLevel: null,
          isLocked: true,
          requestedOff: false,
        });
        plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + HOLIDAY_HOURS;
        continue;
      }

      if (requestedOff) {
        entries.push({
          employeeId: emp.id,
          date: dateStr,
          shiftCode: "C0",
          isPermanence: false,
          permanenceLevel: null,
          isLocked: true,
          requestedOff: true,
        });
        plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + HOLIDAY_HOURS;
        continue;
      }

      const isJlDay = jlAssignments[emp.id]?.has(dateStr) ?? false;
      if (isJlDay && emp.allowedShiftCodes.includes("JL")) {
        onsiteCountByDate[dateStr].add(emp.id);
        entries.push({
          employeeId: emp.id,
          date: dateStr,
          shiftCode: "JL",
          isPermanence: false,
          permanenceLevel: null,
          isLocked: false,
          requestedOff: false,
        });
        plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + HOLIDAY_HOURS;
        continue;
      }

      const empTemplates = templatesByEmployee[emp.id] ?? [];
      let templateShiftCode: string | null = null;

      if (empTemplates.length > 0) {
        const rotIdx = templateRotation[emp.id] ?? 0;
        const tpl = empTemplates[rotIdx % empTemplates.length];
        const dayEntry = tpl.days.find((d) => d.dayOfWeek === dayOfWeek);
        if (dayEntry) templateShiftCode = dayEntry.shiftCode;
      }

      const homeworkUsedSoFar = (emp.homeworkDaysUsedThisYear ?? 0) + (homeworkCountThisMonth[emp.id] ?? 0);
      const canHomework = emp.homeworkEligible && homeworkUsedSoFar < HOMEWORK_DAY_LIMIT;
      const canCowork = emp.coworkEligible;

      const totalDesksByDate = offices
        .filter((o) => o.employeeIds.includes(emp.id))
        .reduce((sum, o) => sum + o.deskCount, 0);

      const onsiteNow = onsiteCountByDate[dateStr]?.size ?? 0;
      const deskAvailable = onsiteNow < totalDesksByDate;

      let chosenCode: string | null = null;

      if (templateShiftCode && emp.allowedShiftCodes.includes(templateShiftCode)) {
        if (isHomeworkCode(templateShiftCode, shiftCodes) && !canHomework) {
          chosenCode = deskAvailable ? bestOnsiteCode(emp.allowedShiftCodes, shiftCodes) : bestCoworkCode(emp.allowedShiftCodes, shiftCodes);
        } else if (isOnsiteCode(templateShiftCode, shiftCodes) && !deskAvailable) {
          chosenCode = canHomework ? bestHomeworkCode(emp.allowedShiftCodes, shiftCodes) : bestCoworkCode(emp.allowedShiftCodes, shiftCodes);
        } else {
          chosenCode = templateShiftCode;
        }
      } else {
        if (deskAvailable) {
          chosenCode = bestOnsiteCode(emp.allowedShiftCodes, shiftCodes);
        } else if (canHomework) {
          chosenCode = bestHomeworkCode(emp.allowedShiftCodes, shiftCodes);
        } else if (canCowork) {
          chosenCode = bestCoworkCode(emp.allowedShiftCodes, shiftCodes);
        } else {
          chosenCode = bestOnsiteCode(emp.allowedShiftCodes, shiftCodes);
        }
      }

      if (isOnsiteCode(chosenCode, shiftCodes)) {
        onsiteCountByDate[dateStr].add(emp.id);
      }
      if (isHomeworkCode(chosenCode, shiftCodes)) {
        homeworkCountThisMonth[emp.id] = (homeworkCountThisMonth[emp.id] ?? 0) + 1;
      }

      plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + hoursForCode(chosenCode, shiftCodes);

      entries.push({
        employeeId: emp.id,
        date: dateStr,
        shiftCode: chosenCode,
        isPermanence: isPermanence,
        permanenceLevel,
        isLocked: false,
        requestedOff: false,
      });
    }

    if (dayOfWeek === 4) {
      for (const e of employees) templateRotation[e.id] = (templateRotation[e.id] ?? 0) + 1;
    }
  }

  const violations: PlanningViolation[] = [];

  for (const dateStr of workingDays) {
    const dayEntries = entries.filter((e) => e.date === dateStr);
    const onsiteEmployeeIds = dayEntries
      .filter((e) => isOnsiteCode(e.shiftCode, shiftCodes) || e.shiftCode === "JL")
      .map((e) => e.employeeId);

    const onsiteSet = new Set(onsiteEmployeeIds);

    const spocPresent = employees.filter((e) => e.isSpoc).some((e) => onsiteSet.has(e.id));
    if (!spocPresent && employees.some((e) => e.isSpoc)) {
      violations.push({ date: dateStr, type: "missing_spoc", message: "No SPOC on-site", employeeId: null });
    }

    const mgmtPresent = employees.filter((e) => e.isManagement).some((e) => onsiteSet.has(e.id));
    if (!mgmtPresent && employees.some((e) => e.isManagement)) {
      violations.push({ date: dateStr, type: "missing_management", message: "No Management on-site", employeeId: null });
    }

    const weekStart = getWeekNumber(dateStr);
    const permaInfo = permanenceAssignments[weekStart];

    const perma1Ids = [permaInfo?.g1l1, permaInfo?.g2l1].filter(Boolean) as number[];
    const perma2Ids = [permaInfo?.g1l2, permaInfo?.g2l2].filter(Boolean) as number[];

    const perma1OnSite = perma1Ids.some((id) => onsiteSet.has(id));
    if (!perma1OnSite && perma1Ids.length > 0) {
      violations.push({ date: dateStr, type: "missing_perma1", message: "No Permanence Level 1 on-site", employeeId: null });
    }

    const perma2OnSite = perma2Ids.some((id) => onsiteSet.has(id));
    if (!perma2OnSite && perma2Ids.length > 0) {
      violations.push({ date: dateStr, type: "missing_perma2", message: "No Permanence Level 2 on-site", employeeId: null });
    }
  }

  for (const emp of employees) {
    const planned = plannedHoursByEmployee[emp.id] ?? 0;
    const prm = planned - contractualHours;
    if (prm > PRM_MAX || prm < PRM_MIN) {
      violations.push({
        date: `${year}-${String(month).padStart(2, "0")}`,
        type: "prm_exceeded",
        message: `${emp.id}: PRM ${prm.toFixed(1)}h out of range (±10h)`,
        employeeId: emp.id,
      });
    }

    const hwTotal = (emp.homeworkDaysUsedThisYear ?? 0) + (homeworkCountThisMonth[emp.id] ?? 0);
    if (hwTotal > HOMEWORK_DAY_LIMIT && (emp.country === "be" || emp.country === "de" || emp.country === "fr")) {
      violations.push({
        date: `${year}-${String(month).padStart(2, "0")}`,
        type: "homework_limit",
        message: `Employee ${emp.id}: homework days ${hwTotal}/${HOMEWORK_DAY_LIMIT} exceeded`,
        employeeId: emp.id,
      });
    }
  }

  return { entries, violations };
}
