import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { fetchMe, type AuthUser } from "@/hooks/use-auth";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  setUser: (u: AuthUser | null) => void;
};

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true, setUser: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
