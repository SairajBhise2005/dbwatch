import axios from 'axios';

// Same-origin by default (nginx proxies /api → backend in Docker).
// Override with VITE_API_URL for local dev against a remote backend.
const baseURL = (import.meta.env.VITE_API_URL ?? '') + '/api';

const PW_KEY = 'dbwatch_pw';

export const api = axios.create({ baseURL });

// Attach the shared dashboard password to every request.
api.interceptors.request.use((config) => {
  const pw = localStorage.getItem(PW_KEY);
  if (pw) config.headers['x-dashboard-password'] = pw;
  return config;
});

// On 401, clear the stored password so the app falls back to login.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem(PW_KEY);
      // Let the app re-render to the login screen.
      window.dispatchEvent(new Event('dbwatch:unauthorized'));
    }
    return Promise.reject(err);
  }
);

// --- Auth helpers ---
export function getStoredPassword(): string | null {
  return localStorage.getItem(PW_KEY);
}

export async function login(password: string): Promise<boolean> {
  const { data } = await api.post('/auth/login', { password });
  if (data?.ok) {
    localStorage.setItem(PW_KEY, password);
    return true;
  }
  return false;
}

export function logout(): void {
  localStorage.removeItem(PW_KEY);
}
