CREATE TABLE IF NOT EXISTS "employee_holiday_balances" (
  "id" serial PRIMARY KEY NOT NULL,
  "employee_id" integer NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "shift_code_code" varchar(16) NOT NULL,
  "balance_hours" real NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uniq_emp_holiday_code" UNIQUE("employee_id", "shift_code_code")
);
