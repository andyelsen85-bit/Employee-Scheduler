import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { fetchMe, type AuthUser } from "@/hooks/use-auth";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  needsSetup: boolean;
  setUser: (u: AuthUser | null) => void;
  setNeedsSetup: (v: boolean) => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  needsSetup: false,
  setUser: () => {},
  setNeedsSetup: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const setupRes = await fetch("/api/auth/setup-status", { credentials: "include" });
        if (setupRes.ok) {
          const { needsSetup: ns } = await setupRes.json() as { needsSetup: boolean };
          if (ns) {
            setNeedsSetup(true);
            setLoading(false);
            return;
          }
        }
      } catch {
        // ignore, fall through to fetchMe
      }

      const u = await fetchMe();
      setUser(u);
      setLoading(false);
    }
    init();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, needsSetup, setUser, setNeedsSetup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
