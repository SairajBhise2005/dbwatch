// middleware/auth.js — single shared-password gate.
//
// Per the project plan, full JWT auth is overkill for a portfolio
// dashboard. Instead the whole app sits behind ONE password
// (DASHBOARD_PASSWORD). The frontend stores it and sends it on every
// request as the `x-dashboard-password` header.
//
// If DASHBOARD_PASSWORD is unset, the gate is disabled (handy for
// local dev) and a warning is logged once at boot.

const PASSWORD = process.env.DASHBOARD_PASSWORD;

if (!PASSWORD) {
  console.warn(
    '[auth] DASHBOARD_PASSWORD not set — API is UNPROTECTED. ' +
      'Set it in .env before deploying.'
  );
}

export function requireAuth(req, res, next) {
  if (!PASSWORD) return next(); // auth disabled
  const provided = req.get('x-dashboard-password');
  if (provided && provided === PASSWORD) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// POST /api/auth/login — verify the password without exposing it.
export function loginHandler(req, res) {
  if (!PASSWORD) return res.json({ ok: true, authDisabled: true });
  const { password } = req.body || {};
  if (password && password === PASSWORD) return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: 'Incorrect password' });
}
