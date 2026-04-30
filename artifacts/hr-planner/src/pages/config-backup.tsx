import { useState, useRef } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, AlertTriangle, CheckCircle2, Loader2, DatabaseBackup } from "lucide-react";

type RestoreState = "idle" | "loading" | "success" | "error";

export default function BackupRestore() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreState, setRestoreState] = useState<RestoreState>("idle");
  const [restoreDetail, setRestoreDetail] = useState<string>("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingJson, setPendingJson] = useState<unknown>(null);
  const [backupMeta, setBackupMeta] = useState<{ exportedAt: string; tables: Record<string, number> } | null>(null);

  function handleExport() {
    const a = document.createElement("a");
    a.href = "/api/backup/export";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string) as {
          version: number;
          exportedAt: string;
          tables: Record<string, unknown[]>;
        };
        if ((json.version !== 1 && json.version !== 2) || !json.tables) {
          toast({ title: "Invalid backup file", description: "The file does not appear to be a valid HR Planner backup.", variant: "destructive" });
          return;
        }
        setBackupMeta({
          exportedAt: json.exportedAt,
          tables: Object.fromEntries(
            Object.entries(json.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
          ),
        });
        setPendingFile(file);
        setPendingJson(json);
        setConfirmVisible(true);
      } catch {
        toast({ title: "Cannot read file", description: "The selected file is not valid JSON.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleRestore() {
    if (!pendingJson) return;
    setConfirmVisible(false);
    setRestoreState("loading");
    setRestoreDetail("");
    try {
      const resp = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingJson),
      });
      let data: { ok?: boolean; error?: string; detail?: string; restoredAt?: string } = {};
      try {
        data = await resp.json() as typeof data;
      } catch {
        // server returned non-JSON (e.g. 413 too large)
        throw new Error(`Server error ${resp.status}: ${resp.statusText}`);
      }
      if (!resp.ok || !data.ok) {
        setRestoreState("error");
        setRestoreDetail(data.detail ?? data.error ?? `Server error ${resp.status}`);
        return;
      }
      setRestoreState("success");
      setRestoreDetail(`Restored at ${new Date(data.restoredAt ?? "").toLocaleString()}`);
      toast({ title: "Restore complete", description: "All data has been replaced from the backup file." });
    } catch (err) {
      setRestoreState("error");
      setRestoreDetail(String(err));
    } finally {
      setPendingFile(null);
      setPendingJson(null);
      setBackupMeta(null);
    }
  }

  const tableLabels: Record<string, string> = {
    departments: "Departments",
    offices: "Offices",
    officeEmployees: "Office ↔ Employee links",
    shiftCodes: "Shift codes",
    publicHolidays: "Public holidays",
    monthlyConfigs: "Monthly configs",
    employees: "Employees",
    weekTemplates: "Week templates",
    planningMonths: "Planning months",
    planningEntries: "Planning entries",
    permanenceOverrides: "Permanence overrides",
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Backup &amp; Restore</h1>
            <p className="text-muted-foreground mt-1">
              Export all data to a JSON file, or restore a previous backup on any fresh installation.
            </p>
          </div>
          <DatabaseBackup className="h-8 w-8 text-muted-foreground" />
        </div>

        {/* Export */}
        <div className="bg-card border rounded-xl p-6 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Download className="h-5 w-5 mt-0.5 text-primary shrink-0" />
            <div>
              <h2 className="font-semibold text-base">Export backup</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Downloads a single JSON file containing all employees, offices, departments, shift codes, public holidays,
                monthly configs, planning data, and permanence settings.
              </p>
            </div>
          </div>
          <Button onClick={handleExport} className="self-start">
            <Download className="h-4 w-4 mr-2" />
            Download backup
          </Button>
        </div>

        {/* Restore */}
        <div className="bg-card border rounded-xl p-6 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Upload className="h-5 w-5 mt-0.5 text-destructive shrink-0" />
            <div>
              <h2 className="font-semibold text-base">Restore from backup</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Select a previously exported JSON backup file. <strong className="text-destructive">This will completely replace all current data</strong> — employees, planning, offices, and everything else.
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFileChange}
          />

          {restoreState === "idle" && (
            <Button
              variant="outline"
              className="self-start border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              Choose backup file…
            </Button>
          )}

          {restoreState === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Restoring — please wait, do not close this page…
            </div>
          )}

          {restoreState === "success" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                {restoreDetail}
              </div>
              <Button
                variant="outline"
                className="self-start border-destructive text-destructive hover:bg-destructive/10 mt-2"
                onClick={() => { setRestoreState("idle"); fileInputRef.current?.click(); }}
              >
                <Upload className="h-4 w-4 mr-2" />
                Restore another file…
              </Button>
            </div>
          )}

          {restoreState === "error" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Restore failed: {restoreDetail}</span>
              </div>
              <Button
                variant="outline"
                className="self-start border-destructive text-destructive hover:bg-destructive/10 mt-2"
                onClick={() => { setRestoreState("idle"); fileInputRef.current?.click(); }}
              >
                <Upload className="h-4 w-4 mr-2" />
                Try again…
              </Button>
            </div>
          )}
        </div>

        {/* Confirmation dialog */}
        {confirmVisible && backupMeta && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border rounded-xl shadow-xl p-6 max-w-md w-full mx-4 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-base">Replace all data?</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    This backup was exported on{" "}
                    <span className="font-medium text-foreground">
                      {new Date(backupMeta.exportedAt).toLocaleString()}
                    </span>.
                    All current data will be permanently deleted and replaced.
                  </p>
                </div>
              </div>

              <div className="bg-muted rounded-lg p-3 text-xs grid grid-cols-2 gap-x-6 gap-y-1">
                {Object.entries(backupMeta.tables).map(([key, count]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{tableLabels[key] ?? key}</span>
                    <span className="font-mono font-medium">{count}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => { setConfirmVisible(false); setPendingFile(null); setPendingJson(null); setBackupMeta(null); }}
                >
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleRestore}>
                  Yes, restore now
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
