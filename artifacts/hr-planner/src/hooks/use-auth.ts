const AUTH_KEY = "hr_planner_auth";
const VALID_USER = "admin";
const VALID_PASS = "admin123";

export function isAuthenticated(): boolean {
  try {
    return localStorage.getItem(AUTH_KEY) === "true";
  } catch {
    return false;
  }
}

export function login(username: string, password: string): boolean {
  if (username === VALID_USER && password === VALID_PASS) {
    localStorage.setItem(AUTH_KEY, "true");
    return true;
  }
  return false;
}

export function logout(): void {
  localStorage.removeItem(AUTH_KEY);
  window.location.reload();
}
