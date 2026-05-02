import { Layout } from "@/components/layout";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Save, Send, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type MailSettingsData = {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  fromAddress: string | null;
  smtpSecure: string | null;
  hasPassword: boolean;
};

export default function MailSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState<MailSettingsData & { smtpPassword: string }>({
    smtpHost: "",
    smtpPort: 587,
    smtpUser: "",
    fromAddress: "",
    smtpSecure: "starttls",
    hasPassword: false,
    smtpPassword: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/mail", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setForm(f => ({
            ...f,
            smtpHost: data.smtpHost ?? "",
            smtpPort: data.smtpPort ?? 587,
            smtpUser: data.smtpUser ?? "",
            fromAddress: data.fromAddress ?? "",
            smtpSecure: data.smtpSecure ?? "starttls",
            hasPassword: data.hasPassword ?? false,
          }));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        smtpHost: form.smtpHost || null,
        smtpPort: form.smtpPort ?? 587,
        smtpUser: form.smtpUser || null,
        fromAddress: form.fromAddress || null,
        smtpSecure: form.smtpSecure,
      };
      if (form.smtpPassword) {
        payload.smtpPassword = form.smtpPassword;
      }
      const res = await fetch("/api/settings/mail", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast({ title: "Mail settings saved" });
      setForm(f => ({ ...f, smtpPassword: "", hasPassword: true }));
    } catch (e: unknown) {
      toast({ title: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    if (!testEmail) { toast({ title: "Enter a recipient email", variant: "destructive" }); return; }
    setTesting(true);
    try {
      const res = await fetch("/api/settings/mail/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Test email sent successfully!" });
      } else {
        toast({ title: `Failed: ${data.error}`, variant: "destructive" });
      }
    } catch (e: unknown) {
      toast({ title: String(e), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col gap-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <Mail className="h-7 w-7 text-muted-foreground" />
          <h1 className="text-3xl font-bold tracking-tight">Mail Settings</h1>
        </div>
        <p className="text-muted-foreground text-sm">Configure SMTP to enable email notifications for shift demand approvals/rejections.</p>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>SMTP Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>SMTP Host</Label>
                    <Input value={form.smtpHost ?? ""} onChange={e => setForm(f => ({ ...f, smtpHost: e.target.value }))} placeholder="smtp.example.com" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input type="number" value={String(form.smtpPort ?? 587)} onChange={e => setForm(f => ({ ...f, smtpPort: Number(e.target.value) }))} placeholder="587" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Security</Label>
                  <Select value={form.smtpSecure ?? "starttls"} onValueChange={v => setForm(f => ({ ...f, smtpSecure: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
                      <SelectItem value="ssl">SSL/TLS (port 465)</SelectItem>
                      <SelectItem value="none">None (port 25)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>SMTP Username</Label>
                  <Input value={form.smtpUser ?? ""} onChange={e => setForm(f => ({ ...f, smtpUser: e.target.value }))} placeholder="user@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>{form.hasPassword ? "SMTP Password (leave blank to keep current)" : "SMTP Password"}</Label>
                  <Input type="password" value={form.smtpPassword} onChange={e => setForm(f => ({ ...f, smtpPassword: e.target.value }))} placeholder="••••••••" />
                </div>
                <div className="space-y-1.5">
                  <Label>From Address</Label>
                  <Input value={form.fromAddress ?? ""} onChange={e => setForm(f => ({ ...f, fromAddress: e.target.value }))} placeholder="HR Planner <noreply@example.com>" />
                </div>
                <Button onClick={handleSave} disabled={saving} className="w-full">
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Saving..." : "Save Settings"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Send Test Email</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Send a test message to verify your SMTP configuration is working correctly.</p>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    placeholder="recipient@example.com"
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={handleTestSend} disabled={testing || !testEmail}>
                    <Send className="h-4 w-4 mr-2" />
                    {testing ? "Sending..." : "Send Test"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
