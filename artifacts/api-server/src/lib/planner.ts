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
  deskCodes: string[];
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
  deskCode: string | null;
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
const MIN_ONSITE_RATIO = 0.5; // at least 50% of shift days must be onsite

function getWorkingDays(year: number, month: number, publicHolidayDates: string[]): string[] {
  const start = startOfMonth(new Date(year, month - 1));
  const end = endOfMonth(new Date(year, month - 1));
  const blockedSet = new Set(publicHolidayDates);
  return eachDayOfInterval({ start, end })
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

/** Shuffle an array in-place using Fisher-Yates. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick the code of a given type whose hours is closest to targetHours.
 * Among equal distance, prefer higher hours (to avoid falling short).
 */
function bestCodeByTarget(
  type: "onsite" | "homework" | "cowork",
  allowed: string[],
  shiftCodes: Record<string, ShiftCodeRecord>,
  targetHours: number
): string | null {
  const candidates = allowed
    .filter((c) => shiftCodes[c]?.type === type)
    .map((c) => ({ code: c, hours: shiftCodes[c].hours }));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const da = Math.abs(a.hours - targetHours);
    const db = Math.abs(b.hours - targetHours);
    if (Math.abs(da - db) > 0.001) return da - db;
    return b.hours - a.hours; // prefer higher hours on tie
  });

  return candidates[0].code;
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

/**
 * Distribute jlDays JL shifts per employee across working days.
 * Constraint: spread them evenly so no two employees share the same JL date if possible.
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

/**
 * Pre-determine a shuffled sequence of day-types for an employee's shift days.
 * Ensures at least MIN_ONSITE_RATIO of days are onsite.
 * The remainder is split between homework/cowork based on eligibility.
 */
function predetermineTypes(
  shiftDayCount: number,
  canHomework: boolean,
  canCowork: boolean
): Array<"onsite" | "homework" | "cowork"> {
  if (shiftDayCount === 0) return [];

  const minOnsite = Math.ceil(shiftDayCount * MIN_ONSITE_RATIO);
  const remaining = shiftDayCount - minOnsite;

  let homeworkDays = 0;
  let coworkDays = 0;

  if (canHomework && canCowork) {
    // Alternate: half homework, half cowork for variety
    homeworkDays = Math.ceil(remaining / 2);
    coworkDays = remaining - homeworkDays;
  } else if (canHomework) {
    homeworkDays = remaining;
  } else if (canCowork) {
    coworkDays = remaining;
  } else {
    // No remote options — all onsite
    return Array(shiftDayCount).fill("onsite");
  }

  const types: Array<"onsite" | "homework" | "cowork"> = [
    ...Array<"onsite">(minOnsite).fill("onsite"),
    ...Array<"homework">(homeworkDays).fill("homework"),
    ...Array<"cowork">(coworkDays).fill("cowork"),
  ];

  // Shuffle so patterns vary week by week across the month
  return shuffle(types);
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

  // Permanence rotation
  const permanenceGroup1L1 = employees.filter((e) => e.permanenceGroup === 1 && e.permanenceLevel === 1);
  const permanenceGroup1L2 = employees.filter((e) => e.permanenceGroup === 1 && e.permanenceLevel === 2);
  const permanenceGroup2L1 = employees.filter((e) => e.permanenceGroup === 2 && e.permanenceLevel === 1);
  const permanenceGroup2L2 = employees.filter((e) => e.permanenceGroup === 2 && e.permanenceLevel === 2);

  const weekStarts = [...new Set(workingDays.map(getWeekNumber))];
  const permanenceAssignments: Record<
    string,
    { g1l1: number | null; g1l2: number | null; g2l1: number | null; g2l2: number | null }
  > = {};

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

  // JL day assignment
  const jlAssignments = distributeJlDays(employees, workingDays, jlDays);

  // ── PHASE 1: Pre-determine day types per employee ──────────────────────────
  // For each employee, produce a shuffled sequence of "onsite" | "homework" | "cowork"
  // for their shift days (working days - JL days - requested-off days).
  // This ensures at least 50% onsite and introduces week-by-week variety.

  const empDayTypeSequence: Record<number, Array<"onsite" | "homework" | "cowork">> = {};
  const empShiftDays: Record<number, string[]> = {};

  for (const emp of employees) {
    const jlDates = jlAssignments[emp.id] ?? new Set();
    const reqOffDates = requestedOffMap[emp.id] ?? new Set();

    // Shift days = working days that are not JL and not requested-off
    const shiftDays = workingDays.filter((d) => !jlDates.has(d) && !reqOffDates.has(d));
    empShiftDays[emp.id] = shiftDays;

    const canHomework =
      emp.homeworkEligible &&
      emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "homework") &&
      (emp.homeworkDaysUsedThisYear ?? 0) < HOMEWORK_DAY_LIMIT;

    const canCowork =
      emp.coworkEligible && emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "cowork");

    empDayTypeSequence[emp.id] = predetermineTypes(shiftDays.length, canHomework, canCowork);
  }

  // ── PHASE 2: Day-by-day assignment ────────────────────────────────────────
  // Track desk pool per date per office: which desks have been assigned
  const deskUsedByDateByOffice: Record<string, Record<number, Set<string>>> = {};
  for (const d of allDays) {
    deskUsedByDateByOffice[d] = {};
    for (const o of offices) deskUsedByDateByOffice[d][o.id] = new Set();
  }

  // Running balance for hour accuracy
  const remainingHours: Record<number, number> = {};
  const remainingShiftDays: Record<number, number> = {};
  for (const emp of employees) {
    const jlCount = jlAssignments[emp.id]?.size ?? 0;
    const reqOffCount = (requestedOffMap[emp.id] ?? new Set()).size;
    remainingHours[emp.id] = contractualHours;
    remainingShiftDays[emp.id] = workingDays.length - jlCount - reqOffCount;
  }

  const homeworkCountThisMonth: Record<number, number> = {};
  const plannedHoursByEmployee: Record<number, number> = {};
  const onsiteCountByEmployee: Record<number, number> = {};
  for (const e of employees) {
    homeworkCountThisMonth[e.id] = 0;
    plannedHoursByEmployee[e.id] = 0;
    onsiteCountByEmployee[e.id] = 0;
  }

  const entries: PlanningEntryInput[] = [];

  // Index per employee: which position in their type sequence we're at
  const empTypeIdx: Record<number, number> = {};
  for (const e of employees) empTypeIdx[e.id] = 0;

  for (const dateStr of allDays) {
    const dayOfWeek = getDayOfWeek0Mon(dateStr);
    const weekStart = getWeekNumber(dateStr);
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    const isPublicHoliday = publicHolidayDates.includes(dateStr);

    for (const emp of employees) {
      if (isWeekend || isPublicHoliday) continue;

      const permaInfo = permanenceAssignments[weekStart];
      const isPermanenceL1 = permaInfo?.g1l1 === emp.id || permaInfo?.g2l1 === emp.id;
      const isPermanenceL2 = permaInfo?.g1l2 === emp.id || permaInfo?.g2l2 === emp.id;
      const isPermanence = isPermanenceL1 || isPermanenceL2;
      const permanenceLevel = isPermanenceL1 ? 1 : isPermanenceL2 ? 2 : null;

      // Requested day off → C0
      if ((requestedOffMap[emp.id] ?? new Set()).has(dateStr)) {
        const holidayHours = hoursForCode("C0", shiftCodes);
        entries.push({
          employeeId: emp.id,
          date: dateStr,
          shiftCode: "C0",
          deskCode: null,
          isPermanence: false,
          permanenceLevel: null,
          isLocked: true,
          requestedOff: true,
        });
        plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + holidayHours;
        remainingHours[emp.id] = (remainingHours[emp.id] ?? 0) - holidayHours;
        continue;
      }

      // JL day
      if ((jlAssignments[emp.id] ?? new Set()).has(dateStr) && emp.allowedShiftCodes.includes("JL")) {
        entries.push({
          employeeId: emp.id,
          date: dateStr,
          shiftCode: "JL",
          deskCode: null,
          isPermanence: false,
          permanenceLevel: null,
          isLocked: false,
          requestedOff: false,
        });
        continue;
      }

      // Running-balance daily target
      const shiftDaysLeft = Math.max(1, remainingShiftDays[emp.id] ?? 1);
      const dailyTarget = (remainingHours[emp.id] ?? 0) / shiftDaysLeft;

      // Get pre-determined type for this shift day
      const typeIdx = empTypeIdx[emp.id] ?? 0;
      const shiftDaysList = empShiftDays[emp.id] ?? [];
      const shiftDayPos = shiftDaysList.indexOf(dateStr);
      let preferredType: "onsite" | "homework" | "cowork" =
        shiftDayPos >= 0 && shiftDayPos < (empDayTypeSequence[emp.id] ?? []).length
          ? (empDayTypeSequence[emp.id]?.[shiftDayPos] ?? "onsite")
          : "onsite";

      empTypeIdx[emp.id] = typeIdx + 1;

      // Find which office(s) this employee belongs to and get available desks
      const empOffices = offices.filter((o) => o.employeeIds.includes(emp.id));
      let assignedDeskCode: string | null = null;
      let deskAvailableFromPool = false;

      if (empOffices.length > 0) {
        // Pick the first office that has available desks
        for (const office of empOffices) {
          const usedDesks = deskUsedByDateByOffice[dateStr]?.[office.id] ?? new Set();
          const availableDesks = office.deskCodes.filter((dc) => !usedDesks.has(dc));
          if (availableDesks.length > 0) {
            deskAvailableFromPool = true;
            // Randomly pick one
            const randomIdx = Math.floor(Math.random() * availableDesks.length);
            assignedDeskCode = availableDesks[randomIdx];
            usedDesks.add(assignedDeskCode);
            break;
          }
        }
        // If no desks from any office pool, fallback (but still can go onsite if office has capacity via deskCount)
        if (!deskAvailableFromPool) {
          // Count how many are already onsite across all these offices
          const totalOnsite = Object.values(deskUsedByDateByOffice[dateStr] ?? {})
            .reduce((sum, s) => sum + s.size, 0);
          const totalCapacity = empOffices.reduce((sum, o) =>
            sum + (o.deskCodes.length > 0 ? o.deskCodes.length : o.deskCount), 0);
          deskAvailableFromPool = totalOnsite < totalCapacity;
        }
      }

      // If employee has no office, they cannot go onsite
      const canGoOnsite = empOffices.length > 0 && deskAvailableFromPool;

      const homeworkUsedSoFar = (emp.homeworkDaysUsedThisYear ?? 0) + (homeworkCountThisMonth[emp.id] ?? 0);
      const canHomework = emp.homeworkEligible &&
        emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "homework") &&
        homeworkUsedSoFar < HOMEWORK_DAY_LIMIT;
      const canCowork = emp.coworkEligible &&
        emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "cowork");

      // Enforce preferred type, with fallback if constraints prevent it
      let chosenCode: string | null = null;
      let actualDeskCode: string | null = null;

      if (preferredType === "onsite") {
        if (canGoOnsite) {
          chosenCode = bestCodeByTarget("onsite", emp.allowedShiftCodes, shiftCodes, dailyTarget);
          actualDeskCode = assignedDeskCode;
        } else {
          // Desk not available — fallback to homework or cowork
          if (canHomework) {
            chosenCode = bestCodeByTarget("homework", emp.allowedShiftCodes, shiftCodes, dailyTarget);
          } else if (canCowork) {
            chosenCode = bestCodeByTarget("cowork", emp.allowedShiftCodes, shiftCodes, dailyTarget);
          } else {
            // No remote option at all, force onsite without desk code (shouldn't normally happen)
            chosenCode = bestCodeByTarget("onsite", emp.allowedShiftCodes, shiftCodes, dailyTarget);
          }
        }
      } else if (preferredType === "homework") {
        if (canHomework) {
          chosenCode = bestCodeByTarget("homework", emp.allowedShiftCodes, shiftCodes, dailyTarget);
        } else if (canGoOnsite) {
          chosenCode = bestCodeByTarget("onsite", emp.allowedShiftCodes, shiftCodes, dailyTarget);
          actualDeskCode = assignedDeskCode;
        } else if (canCowork) {
          chosenCode = bestCodeByTarget("cowork", emp.allowedShiftCodes, shiftCodes, dailyTarget);
        }
      } else {
        // cowork
        if (canCowork) {
          chosenCode = bestCodeByTarget("cowork", emp.allowedShiftCodes, shiftCodes, dailyTarget);
        } else if (canGoOnsite) {
          chosenCode = bestCodeByTarget("onsite", emp.allowedShiftCodes, shiftCodes, dailyTarget);
          actualDeskCode = assignedDeskCode;
        } else if (canHomework) {
          chosenCode = bestCodeByTarget("homework", emp.allowedShiftCodes, shiftCodes, dailyTarget);
        }
      }

      // If desk was "reserved" but we ended up not going onsite, release it
      if (actualDeskCode === null && assignedDeskCode !== null) {
        // Release the desk back to the pool
        for (const office of empOffices) {
          const usedDesks = deskUsedByDateByOffice[dateStr]?.[office.id];
          if (usedDesks?.has(assignedDeskCode)) {
            usedDesks.delete(assignedDeskCode);
            break;
          }
        }
      }

      const assignedHours = hoursForCode(chosenCode, shiftCodes);

      if (isOnsiteCode(chosenCode, shiftCodes)) {
        onsiteCountByEmployee[emp.id] = (onsiteCountByEmployee[emp.id] ?? 0) + 1;
      }
      if (isHomeworkCode(chosenCode, shiftCodes)) {
        homeworkCountThisMonth[emp.id] = (homeworkCountThisMonth[emp.id] ?? 0) + 1;
      }

      plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + assignedHours;
      remainingHours[emp.id] = (remainingHours[emp.id] ?? 0) - assignedHours;
      remainingShiftDays[emp.id] = Math.max(0, (remainingShiftDays[emp.id] ?? 0) - 1);

      entries.push({
        employeeId: emp.id,
        date: dateStr,
        shiftCode: chosenCode,
        deskCode: actualDeskCode,
        isPermanence: isPermanence,
        permanenceLevel,
        isLocked: false,
        requestedOff: false,
      });
    }
  }

  // ── VIOLATIONS ─────────────────────────────────────────────────────────────
  const violations: PlanningViolation[] = [];

  for (const dateStr of workingDays) {
    const dayEntries = entries.filter((e) => e.date === dateStr);
    const onsiteSet = new Set(
      dayEntries.filter((e) => isOnsiteCode(e.shiftCode, shiftCodes)).map((e) => e.employeeId)
    );

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

    if (perma1Ids.length > 0 && !perma1Ids.some((id) => onsiteSet.has(id))) {
      violations.push({ date: dateStr, type: "missing_perma1", message: "No Permanence Level 1 on-site", employeeId: null });
    }
    if (perma2Ids.length > 0 && !perma2Ids.some((id) => onsiteSet.has(id))) {
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
        message: `Employee ${emp.id}: PRM ${prm.toFixed(1)}h out of range (±10h)`,
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

    // Check 50% onsite minimum
    const shiftDays = empShiftDays[emp.id]?.length ?? 0;
    const onsiteCount = onsiteCountByEmployee[emp.id] ?? 0;
    if (shiftDays > 0 && onsiteCount < Math.ceil(shiftDays * MIN_ONSITE_RATIO)) {
      violations.push({
        date: `${year}-${String(month).padStart(2, "0")}`,
        type: "insufficient_onsite",
        message: `Employee ${emp.id}: only ${onsiteCount}/${shiftDays} days onsite (min 50%)`,
        employeeId: emp.id,
      });
    }
  }

  return { entries, violations };
}
