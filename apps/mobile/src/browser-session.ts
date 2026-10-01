// Web sessions last for this tab, not browser restarts. Never store a password or provider key.
const key = (apiUrl: string) => `openmuse-session:${apiUrl}`;

export function readBrowserSession(apiUrl: string): string {
  try {
    return typeof sessionStorage === "undefined" ? "" : (sessionStorage.getItem(key(apiUrl)) ?? "");
  } catch {
    return ""; // Native clients and browsers blocking storage retain in-memory sign-in.
  }
}

export function writeBrowserSession(apiUrl: string, token: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (token) sessionStorage.setItem(key(apiUrl), token);
    else sessionStorage.removeItem(key(apiUrl));
  } catch {
    // A storage restriction must not prevent sign-in or server-side logout.
  }
}
