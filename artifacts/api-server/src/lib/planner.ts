import { addDays, format, getDay, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";

export type ShiftCodeRecord = {
  code: string;
  hours: number;
  type: string;
};

export type DayCodePreference = { day: number; code: string };

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
  dayCodePreferences: DayCodePreference[];
  prefersHeightAdjustableDesk: boolean;
};

export type OfficeRecord = {
  id: number;
  deskCount: number;
  deskCodes: string[];
  heightAdjustableDesks: string[];
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
    // On equal distance: prefer the code that stays at or below target to avoid overshoot
    const aOver = a.hours > targetHours;
    const bOver = b.hours > targetHours;
    if (aOver && !bOver) return 1;
    if (!aOver && bOver) return -1;
    return b.hours - a.hours; // both same side: prefer higher
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
 * Assign JL (free day) slots to each employee for a given number of days.
 * Spreads evenly across the month (load-balanced) with random tiebreaking.
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

    // Prefer placing pre-assigned JL on weekdays the employee already wants as JL.
    // This way the monthly JL "merges" into a preference-JL slot rather than adding
    // an extra JL on a neutral day (which would cause unnecessary PRM undershoot).
    const jlPrefWeekdays = new Set(
      (emp.dayCodePreferences ?? [])
        .filter((p) => p.code === "JL")
        .map((p) => p.day)
    );
    const preferredJlWorkingDays = workingDays.filter((d) => jlPrefWeekdays.has(getDayOfWeek0Mon(d)));
    const otherWorkingDays = workingDays.filter((d) => !jlPrefWeekdays.has(getDayOfWeek0Mon(d)));

    // Within each tier, shuffle then stable-sort by load
    const shuffledPref = shuffle([...preferredJlWorkingDays]);
    shuffledPref.sort((a, b) => (jlCountByDate[a] ?? 0) - (jlCountByDate[b] ?? 0));
    const shuffledOther = shuffle([...otherWorkingDays]);
    shuffledOther.sort((a, b) => (jlCountByDate[a] ?? 0) - (jlCountByDate[b] ?? 0));

    const prioritized = [...shuffledPref, ...shuffledOther];
    const count = Math.min(jlDays, workingDays.length);
    const picked = prioritized.slice(0, count);
    for (const d of picked) {
      jlAssignments[emp.id].add(d);
      jlCountByDate[d] = (jlCountByDate[d] ?? 0) + 1;
    }
  }

  return jlAssignments;
}

/**
 * Pre-compute which shift days should become JL substitutions for an employee.
 *
 * Priority order:
 *   1. Days whose weekday has an explicit JL preference (user wants free days here).
 *   2. Days with NO code preference and not in avoidWeekdays (neutral days).
 *   3. Days in avoidWeekdays (has a non-JL preference) — last resort, sorted by
 *      highest expected hours first so we sacrifice the fewest preference-days.
 */
function pickJlSubstitutionDates(
  candidateShiftDays: string[],
  neededJL: number,
  preferredWeekdays: number[],
  avoidWeekdays: Set<number> = new Set(),
  expectedHoursForDate: (d: string) => number = () => 8
): string[] {
  if (neededJL <= 0 || candidateShiftDays.length === 0) return [];
  const n = Math.min(neededJL, candidateShiftDays.length - 1);

  const preferredSet = new Set(preferredWeekdays);

  // Tier 1: explicit JL preference weekdays
  const tier1 = shuffle(candidateShiftDays.filter((d) => preferredSet.has(getDayOfWeek0Mon(d))));
  // Tier 2: neutral days (no preference, not asked to avoid)
  const tier2 = shuffle(
    candidateShiftDays.filter((d) => !preferredSet.has(getDayOfWeek0Mon(d)) && !avoidWeekdays.has(getDayOfWeek0Mon(d)))
  );
  // Tier 3: days with a code preference — pick highest-hour days first to preserve low-hour preference days
  const tier3 = candidateShiftDays
    .filter((d) => !preferredSet.has(getDayOfWeek0Mon(d)) && avoidWeekdays.has(getDayOfWeek0Mon(d)))
    .sort((a, b) => expectedHoursForDate(b) - expectedHoursForDate(a));

  const result: string[] = [];
  for (const d of [...tier1, ...tier2, ...tier3]) {
    if (result.length >= n) break;
    result.push(d);
  }
  return result;
}

/**
 * Assign one location-type per ISO week so employees stay in the same place all week.
 * Ensures at least MIN_ONSITE_RATIO of weeks are onsite.
 */
function predetermineWeeklyTypes(
  weekKeys: string[],
  canHomework: boolean,
  canCowork: boolean
): Record<string, "onsite" | "homework" | "cowork"> {
  if (weekKeys.length === 0) return {};

  const numWeeks = weekKeys.length;
  const minOnsiteWeeks = Math.ceil(numWeeks * MIN_ONSITE_RATIO);
  const remaining = numWeeks - minOnsiteWeeks;

  let homeworkWeeks = 0;
  let coworkWeeks = 0;
  if (canHomework && canCowork) {
    homeworkWeeks = Math.ceil(remaining / 2);
    coworkWeeks = remaining - homeworkWeeks;
  } else if (canHomework) {
    homeworkWeeks = remaining;
  } else if (canCowork) {
    coworkWeeks = remaining;
  }

  const weekTypes: Array<"onsite" | "homework" | "cowork"> = [
    ...Array<"onsite">(minOnsiteWeeks).fill("onsite"),
    ...Array<"homework">(homeworkWeeks).fill("homework"),
    ...Array<"cowork">(coworkWeeks).fill("cowork"),
  ];
  const shuffledTypes = shuffle(weekTypes);

  const result: Record<string, "onsite" | "homework" | "cowork"> = {};
  weekKeys.forEach((wk, i) => { result[wk] = shuffledTypes[i] ?? "onsite"; });
  return result;
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

  // Permanence rotation — 1 employee per group per week, no level distinction
  const permanenceGroup1 = employees.filter((e) => e.permanenceGroup === 1);
  const permanenceGroup2 = employees.filter((e) => e.permanenceGroup === 2);

  const weekStarts = [...new Set(workingDays.map(getWeekNumber))];
  const permanenceAssignments: Record<string, { g1: number | null; g2: number | null }> = {};

  function rotateAssign(group: EmployeeRecord[], weekIdx: number): number | null {
    if (group.length === 0) return null;
    return group[weekIdx % group.length].id;
  }

  weekStarts.forEach((ws, idx) => {
    permanenceAssignments[ws] = {
      g1: rotateAssign(permanenceGroup1, idx),
      g2: rotateAssign(permanenceGroup2, idx),
    };
  });

  // JL day assignment (pre-configured from monthly config)
  const jlAssignments = distributeJlDays(employees, workingDays, jlDays);

  // Per-employee contractual hours (scaled by contract %) with PRM counter compensation
  const empContractualHours: Record<number, number> = {};
  const empBaseContractualHours: Record<number, number> = {};
  for (const emp of employees) {
    const pct = emp.contractPercent ?? 100;
    const base = Math.round(contractualHours * (pct / 100) * 10) / 10;
    empBaseContractualHours[emp.id] = base;
    // Adjust monthly target by PRM counter to trend it back towards 0
    // If prmCounter > 0 (overpaid hours), plan fewer hours this month; if < 0, plan more
    const prm = emp.prmCounter ?? 0;
    const clampedPrm = Math.max(-10, Math.min(10, prm));
    empContractualHours[emp.id] = Math.round(Math.max(0, base - clampedPrm) * 10) / 10;
  }

  // ── PHASE 1: Pre-determine day types + JL substitutions per employee ───────
  // Each ISO week gets a single location type (onsite/homework/cowork) so employees
  // stay at the same place all week. JL substitutions are spread randomly.

  const empDayTypeMap: Record<number, Record<string, "onsite" | "homework" | "cowork">> = {};
  const empShiftDays: Record<number, string[]> = {};
  const jlSubstitutionDates: Record<number, Set<string>> = {};

  for (const emp of employees) {
    const jlDates = jlAssignments[emp.id] ?? new Set();
    const reqOffDates = requestedOffMap[emp.id] ?? new Set();

    // Candidate shift days = working days that are not pre-assigned JL and not requested-off
    const candidateShiftDays = workingDays.filter((d) => !jlDates.has(d) && !reqOffDates.has(d));

    // Compute how many JL substitutions are needed.
    // Strategy: use the full-time equivalent daily hours (contractualHours / workingDays) as
    // the reference for the "typical shift length". This ensures part-time employees receive
    // full-length shifts on fewer days (the rest become JL), rather than getting many half-days.
    const empTarget = empContractualHours[emp.id];
    const regularCodes = emp.allowedShiftCodes.filter((c) => c !== "JL" && c !== "C0");
    const regularHours = regularCodes.map((c) => shiftCodes[c]?.hours ?? 0).filter((h) => h > 0);

    // Full-time reference: what daily hours would a 100% employee get?
    const fteDaily = candidateShiftDays.length > 0 ? contractualHours / candidateShiftDays.length : 8;
    // Typical shift = the code hours closest to the full-time daily reference
    const typicalShiftHours = regularHours.length > 0
      ? regularHours.reduce((best, h) => Math.abs(h - fteDaily) <= Math.abs(best - fteDaily) ? h : best, regularHours[0])
      : null;

    // Helper: expected hours for a candidate shift day.
    // When multiple preferences exist for the same weekday, uses their average so that
    // the neededJL calculation correctly accounts for the rotation across all codes.
    const getExpectedHours = (dateStr: string): number => {
      const dow = getDayOfWeek0Mon(dateStr);
      const uniquePrefs = (emp.dayCodePreferences ?? [])
        .filter((p) => p.day === dow && p.code !== "JL" && p.code !== "C0" && emp.allowedShiftCodes.includes(p.code))
        .filter((p, idx, arr) => arr.findIndex((q) => q.code === p.code) === idx);
      if (uniquePrefs.length === 0) return typicalShiftHours ?? 8;
      const avg = uniquePrefs.reduce((s, p) => s + (shiftCodes[p.code]?.hours ?? 0), 0) / uniquePrefs.length;
      return avg;
    };

    // Preference-weighted total: sum of expected hours if all candidate days were shift days
    const totalExpectedIfAllShift = candidateShiftDays.reduce((s, d) => s + getExpectedHours(d), 0);
    // Average expected hours per shift day (accounts for short-hour preference codes like TT4)
    const weightedAvgHours = candidateShiftDays.length > 0
      ? totalExpectedIfAllShift / candidateShiftDays.length
      : (typicalShiftHours ?? 8);

    // Derive preferred JL weekdays from day code preferences (entries where code === "JL")
    const jlPreferredWeekdays = (emp.dayCodePreferences ?? [])
      .filter((p) => p.code === "JL")
      .map((p) => p.day);

    // Weekdays that have a non-JL/non-C0 code preference — protect from JL selection
    const avoidJlWeekdays = new Set(
      (emp.dayCodePreferences ?? [])
        .filter((p) => p.code !== "JL" && p.code !== "C0" && emp.allowedShiftCodes.includes(p.code))
        .map((p) => p.day)
    );

    let neededJL = 0;
    if (weightedAvgHours > 0 && totalExpectedIfAllShift > empTarget) {
      neededJL = candidateShiftDays.length - Math.ceil(empTarget / weightedAvgHours);
    }
    neededJL = Math.max(0, neededJL);

    // Guarantee ALL preferred-JL weekdays become JL — day preferences take priority over
    // the hours calculation. Any resulting hour shortfall is absorbed by the PRM counter.
    if (jlPreferredWeekdays.length > 0) {
      const preferredJLdaysCount = candidateShiftDays.filter(
        (d) => jlPreferredWeekdays.includes(getDayOfWeek0Mon(d))
      ).length;
      neededJL = Math.max(neededJL, preferredJLdaysCount);
    }

    const subDates = pickJlSubstitutionDates(candidateShiftDays, neededJL, jlPreferredWeekdays, avoidJlWeekdays, getExpectedHours);
    jlSubstitutionDates[emp.id] = new Set(subDates);

    // Actual shift days exclude both pre-assigned JL and substitution JL
    const shiftDays = candidateShiftDays.filter((d) => !jlSubstitutionDates[emp.id].has(d));
    empShiftDays[emp.id] = shiftDays;

    const canHomework =
      emp.homeworkEligible &&
      emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "homework") &&
      (emp.homeworkDaysUsedThisYear ?? 0) < HOMEWORK_DAY_LIMIT;
    const canCowork =
      emp.coworkEligible && emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "cowork");

    // Group shift days by ISO week and assign one type per week
    const shiftDaysByWeek: Record<string, string[]> = {};
    for (const day of shiftDays) {
      const wk = getWeekNumber(day);
      if (!shiftDaysByWeek[wk]) shiftDaysByWeek[wk] = [];
      shiftDaysByWeek[wk].push(day);
    }
    const weekTypeMap = predetermineWeeklyTypes(Object.keys(shiftDaysByWeek), canHomework, canCowork);

    // Build day → type lookup
    empDayTypeMap[emp.id] = {};
    for (const [wk, type] of Object.entries(weekTypeMap)) {
      for (const day of shiftDaysByWeek[wk] ?? []) {
        empDayTypeMap[emp.id][day] = type;
      }
    }
  }

  // ── PHASE 2: Day-by-day assignment ────────────────────────────────────────
  // Track desk pool per ISO-week per office so employees keep the same desk all week
  const allWeekKeys = [...new Set(allDays.map(getWeekNumber))];
  const deskUsedByWeekByOffice: Record<string, Record<number, Set<string>>> = {};
  for (const wk of allWeekKeys) {
    deskUsedByWeekByOffice[wk] = {};
    for (const o of offices) deskUsedByWeekByOffice[wk][o.id] = new Set();
  }
  // Per-employee per-week desk assignment (undefined = not yet assigned this week)
  const weeklyDeskByEmp: Record<number, Record<string, string | null>> = {};
  for (const e of employees) weeklyDeskByEmp[e.id] = {};

  // Running balance for hour accuracy
  const remainingHours: Record<number, number> = {};
  const remainingShiftDays: Record<number, number> = {};
  for (const emp of employees) {
    remainingHours[emp.id] = empContractualHours[emp.id];
    remainingShiftDays[emp.id] = empShiftDays[emp.id].length;
  }

  // Round-robin rotation index per employee per day-of-week.
  // Advances each time a shift day (non-JL, non-C0) is processed, so preferences
  // cycle evenly: e.g. [X80, TT8] on Monday → X80, TT8, X80, TT8 …
  const dayPrefRotation: Record<number, Record<number, number>> = {};
  for (const emp of employees) dayPrefRotation[emp.id] = {};

  const homeworkCountThisMonth: Record<number, number> = {};
  const plannedHoursByEmployee: Record<number, number> = {};
  const onsiteCountByEmployee: Record<number, number> = {};
  for (const e of employees) {
    homeworkCountThisMonth[e.id] = 0;
    plannedHoursByEmployee[e.id] = 0;
    onsiteCountByEmployee[e.id] = 0;
  }

  const entries: PlanningEntryInput[] = [];

  for (const dateStr of allDays) {
    const dayOfWeek = getDayOfWeek0Mon(dateStr);
    const weekStart = getWeekNumber(dateStr);
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    const isPublicHoliday = publicHolidayDates.includes(dateStr);

    for (const emp of employees) {
      if (isWeekend || isPublicHoliday) continue;

      const permaInfo = permanenceAssignments[weekStart];
      const isPermanence = permaInfo?.g1 === emp.id || permaInfo?.g2 === emp.id;
      const permanenceLevel = null; // Level distinction removed

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

      // Pre-assigned JL day (from monthly config)
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

      // JL substitution day (pre-computed in Phase 1 to avoid hour overshoot)
      if (jlSubstitutionDates[emp.id]?.has(dateStr)) {
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

      // Get pre-determined type for this week (weekly grouping)
      let preferredType: "onsite" | "homework" | "cowork" =
        empDayTypeMap[emp.id]?.[dateStr] ?? "onsite";

      // Day-of-week code preference: rotate round-robin through all valid non-JL/non-C0
      // preferences for this weekday. Deduplicate by code first so duplicates don't skew
      // the rotation. The counter advances once per actual shift day reached here.
      const matchingPrefs = (emp.dayCodePreferences ?? [])
        .filter((p) => p.day === dayOfWeek && p.code !== "JL" && p.code !== "C0" && emp.allowedShiftCodes.includes(p.code))
        .filter((p, idx, arr) => arr.findIndex((q) => q.code === p.code) === idx);
      let dayPrefCode: string | null = null;
      if (matchingPrefs.length > 0) {
        const rotIdx = dayPrefRotation[emp.id][dayOfWeek] ?? 0;
        dayPrefCode = matchingPrefs[rotIdx % matchingPrefs.length].code;
        dayPrefRotation[emp.id][dayOfWeek] = rotIdx + 1;
      }
      const dayPrefCodeValid = dayPrefCode !== null;
      const dayPrefType = dayPrefCodeValid ? (shiftCodes[dayPrefCode]?.type as "onsite" | "homework" | "cowork" | undefined) ?? null : null;
      if (dayPrefType === "onsite" || dayPrefType === "homework" || dayPrefType === "cowork") {
        preferredType = dayPrefType;
      }

      // Find which office(s) this employee belongs to
      const empOffices = offices.filter((o) => o.employeeIds.includes(emp.id));
      let assignedDeskCode: string | null = null;
      let deskAvailableFromPool = false;

      if (empOffices.length > 0) {
        // Check if employee already has a desk reserved for this week
        const existingWeekDesk = weeklyDeskByEmp[emp.id]?.[weekStart];
        if (existingWeekDesk !== undefined) {
          // Reuse same desk for consistency across the week
          assignedDeskCode = existingWeekDesk;
          deskAvailableFromPool = assignedDeskCode !== null;
        } else {
          // First potential onsite day this week — pick from weekly pool
          for (const office of empOffices) {
            const weekUsed = deskUsedByWeekByOffice[weekStart]?.[office.id] ?? new Set();
            const allAvailable = office.deskCodes.filter((dc) => !weekUsed.has(dc));
            if (allAvailable.length > 0) {
              deskAvailableFromPool = true;
              // Prefer height-adjustable desks if the employee has that preference
              const haDeskPool = emp.prefersHeightAdjustableDesk
                ? allAvailable.filter((dc) => (office.heightAdjustableDesks ?? []).includes(dc))
                : [];
              const candidatePool = haDeskPool.length > 0 ? haDeskPool : allAvailable;
              const randomIdx = Math.floor(Math.random() * candidatePool.length);
              assignedDeskCode = candidatePool[randomIdx];
              // Reserve desk for the whole week immediately
              (deskUsedByWeekByOffice[weekStart] ??= {})[office.id] ??= new Set();
              deskUsedByWeekByOffice[weekStart][office.id].add(assignedDeskCode);
              weeklyDeskByEmp[emp.id][weekStart] = assignedDeskCode;
              break;
            }
          }
          if (!deskAvailableFromPool) {
            // No individual desk available — mark this week as "no desk"
            weeklyDeskByEmp[emp.id][weekStart] = null;
          }
        }
      }

      // If employee has no office or no desk, they cannot go onsite
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

      // An explicit day preference overrides eligibility flags (homeworkEligible /
      // coworkEligible). The employee or manager deliberately set this code for
      // this weekday, so we honour it as long as the code is in allowedShiftCodes
      // and the homework-day annual limit is not exceeded.
      const dayPrefForcesHomework =
        dayPrefCodeValid &&
        dayPrefType === "homework" &&
        emp.allowedShiftCodes.includes(dayPrefCode!) &&
        homeworkUsedSoFar < HOMEWORK_DAY_LIMIT;
      const dayPrefForcesCowork =
        dayPrefCodeValid &&
        dayPrefType === "cowork" &&
        emp.allowedShiftCodes.includes(dayPrefCode!);

      // Helper: pick code for a type, using day preference first if it matches
      const pickCode = (type: "onsite" | "homework" | "cowork"): string | null => {
        if (dayPrefCodeValid && dayPrefType === type) return dayPrefCode;
        return bestCodeByTarget(type, emp.allowedShiftCodes, shiftCodes, dailyTarget);
      };

      if (preferredType === "onsite") {
        if (canGoOnsite) {
          chosenCode = pickCode("onsite");
          actualDeskCode = assignedDeskCode;
        } else {
          if (canHomework) {
            chosenCode = pickCode("homework");
          } else if (canCowork) {
            chosenCode = pickCode("cowork");
          } else {
            chosenCode = pickCode("onsite");
          }
        }
      } else if (preferredType === "homework") {
        if (canHomework || dayPrefForcesHomework) {
          chosenCode = pickCode("homework");
        } else if (canGoOnsite) {
          chosenCode = pickCode("onsite");
          actualDeskCode = assignedDeskCode;
        } else if (canCowork) {
          chosenCode = pickCode("cowork");
        }
      } else {
        if (canCowork || dayPrefForcesCowork) {
          chosenCode = pickCode("cowork");
        } else if (canGoOnsite) {
          chosenCode = pickCode("onsite");
          actualDeskCode = assignedDeskCode;
        } else if (canHomework) {
          chosenCode = pickCode("homework");
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

    const permaG1Id = permaInfo?.g1 ?? null;
    const permaG2Id = permaInfo?.g2 ?? null;

    if (permaG1Id !== null && !onsiteSet.has(permaG1Id)) {
      violations.push({ date: dateStr, type: "missing_perma1", message: "Permanence Group 1 not on-site", employeeId: null });
    }
    if (permaG2Id !== null && !onsiteSet.has(permaG2Id)) {
      violations.push({ date: dateStr, type: "missing_perma2", message: "Permanence Group 2 not on-site", employeeId: null });
    }
  }

  for (const emp of employees) {
    const planned = plannedHoursByEmployee[emp.id] ?? 0;
    // PRM diff vs base (uncompensated) contractual hours — so the counter tracks true deviation
    const prm = planned - (empBaseContractualHours[emp.id] ?? contractualHours);
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
