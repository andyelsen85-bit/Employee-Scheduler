import { db, shiftCodesTable, publicHolidaysTable, monthlyConfigsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const SHIFT_CODES = [
  { code: "X78", label: "Onsite 4h00",  hours: 4,   type: "onsite" },
  { code: "X79", label: "Onsite 6h00",  hours: 6,   type: "onsite" },
  { code: "X80", label: "Onsite 8h00",  hours: 8,   type: "onsite" },
  { code: "X81", label: "Onsite 9h00",  hours: 9,   type: "onsite" },
  { code: "X82", label: "Onsite 10h00", hours: 10,  type: "onsite" },
  { code: "TT2", label: "Homework 2h",  hours: 2,   type: "homework" },
  { code: "TT4", label: "Homework 4h",  hours: 4,   type: "homework" },
  { code: "TT6", label: "Homework 6h",  hours: 6,   type: "homework" },
  { code: "TT8", label: "Homework 8h",  hours: 8,   type: "homework" },
  { code: "TT9", label: "Homework 9h",  hours: 9,   type: "homework" },
  { code: "CW4", label: "Cowork 4h",    hours: 4,   type: "cowork" },
  { code: "CW6", label: "Cowork 6h",    hours: 6,   type: "cowork" },
  { code: "CW8", label: "Cowork 8h",    hours: 8,   type: "cowork" },
  { code: "CW9", label: "Cowork 9h",    hours: 9,   type: "cowork" },
  { code: "C0",  label: "Holiday / Congé (7h36)", hours: 7.6, type: "holiday" },
  { code: "JL",  label: "CCT-FHL (JL Day)",       hours: 0,   type: "jl" },
];

const LU_PUBLIC_HOLIDAYS_2026 = [
  { date: "2026-01-01", name: "New Year's Day", country: "lu" },
  { date: "2026-04-06", name: "Easter Monday", country: "lu" },
  { date: "2026-05-01", name: "Labour Day", country: "lu" },
  { date: "2026-05-14", name: "Ascension Day", country: "lu" },
  { date: "2026-05-25", name: "Whit Monday", country: "lu" },
  { date: "2026-06-23", name: "Luxembourg National Day", country: "lu" },
  { date: "2026-12-25", name: "Christmas Day", country: "lu" },
];

const MONTHLY_CONFIGS_2026 = [
  { month: 1, contractualHours: 160, jlDays: 1 },
  { month: 2, contractualHours: 160, jlDays: 1 },
  { month: 3, contractualHours: 168, jlDays: 1 },
  { month: 4, contractualHours: 160, jlDays: 1 },
  { month: 5, contractualHours: 146, jlDays: 0 },
  { month: 6, contractualHours: 160, jlDays: 1 },
  { month: 7, contractualHours: 176, jlDays: 1 },
  { month: 8, contractualHours: 160, jlDays: 1 },
  { month: 9, contractualHours: 168, jlDays: 1 },
  { month: 10, contractualHours: 168, jlDays: 1 },
  { month: 11, contractualHours: 160, jlDays: 1 },
  { month: 12, contractualHours: 160, jlDays: 2 },
];

async function seedShiftCodes() {
  console.log("Seeding shift codes...");
  for (const sc of SHIFT_CODES) {
    const existing = await db.select().from(shiftCodesTable).where(eq(shiftCodesTable.code, sc.code));
    if (existing.length === 0) {
      await db.insert(shiftCodesTable).values(sc);
      console.log(`  + ${sc.code}`);
    } else {
      await db.update(shiftCodesTable)
        .set({ label: sc.label, hours: sc.hours, type: sc.type })
        .where(eq(shiftCodesTable.code, sc.code));
      console.log(`  ~ ${sc.code} (updated)`);
    }
  }
}

async function seedPublicHolidays() {
  console.log("Seeding 2026 Luxembourg public holidays...");
  for (const h of LU_PUBLIC_HOLIDAYS_2026) {
    const existing = await db
      .select()
      .from(publicHolidaysTable)
      .where(and(eq(publicHolidaysTable.date, h.date), eq(publicHolidaysTable.country, h.country)));
    if (existing.length === 0) {
      await db.insert(publicHolidaysTable).values(h);
      console.log(`  + ${h.date} ${h.name}`);
    } else {
      console.log(`  = ${h.date} (already exists)`);
    }
  }
}

async function seedMonthlyConfigs() {
  console.log("Seeding 2026 monthly configs...");
  for (const mc of MONTHLY_CONFIGS_2026) {
    const existing = await db
      .select()
      .from(monthlyConfigsTable)
      .where(and(eq(monthlyConfigsTable.year, 2026), eq(monthlyConfigsTable.month, mc.month)));
    if (existing.length === 0) {
      await db.insert(monthlyConfigsTable).values({
        year: 2026,
        month: mc.month,
        contractualHours: mc.contractualHours,
        jlDays: mc.jlDays,
        notes: null,
      });
      console.log(`  + 2026-${String(mc.month).padStart(2, "0")}: ${mc.contractualHours}h`);
    } else {
      console.log(`  = 2026-${String(mc.month).padStart(2, "0")} (already exists)`);
    }
  }
}

async function main() {
  await seedShiftCodes();
  await seedPublicHolidays();
  await seedMonthlyConfigs();
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
