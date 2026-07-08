// routes/backup.js — Backup Manager (Stage 4)
//   POST   /api/backup/create            — run pg_dump -Fc
//   GET    /api/backup/list              — list backups + retention info
//   GET    /api/backup/download/:file    — download a .dump file
//   DELETE /api/backup/:file             — delete a backup
//
// Relies on the backend running on the SAME host as PostgreSQL (the
// Docker-on-EC2 architecture) so pg_dump can reach it. The backend
// image bundles postgresql-client.
//
// Enhancements included:
//   • concurrency lock — only one pg_dump at a time (409 otherwise)
//   • retention policy — keep newest BACKUP_KEEP_COUNT and drop
//     anything older than BACKUP_KEEP_DAYS, after each backup
//   • delete endpoint — manual cleanup
// Restore is intentionally NOT exposed — it's a destructive manual op.

import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

const PG_DUMP = process.env.PG_DUMP_BIN || 'pg_dump';
const NAME_RE = /^backup_[\w-]+\.dump$/;

// Module-level lock — prevents two concurrent pg_dump processes.
let backupInProgress = false;

function backupDir() {
  return path.resolve(process.env.BACKUP_DIR || './backups');
}

function retentionConfig() {
  return {
    keepCount: Number(process.env.BACKUP_KEEP_COUNT ?? 10),
    keepDays: Number(process.env.BACKUP_KEEP_DAYS ?? 30),
  };
}

// Validate a user-supplied filename (defends against path traversal).
function safeName(name) {
  const base = path.basename(String(name || ''));
  return NAME_RE.test(base) ? base : null;
}

async function listBackups(dir) {
  await fs.mkdir(dir, { recursive: true });
  const names = (await fs.readdir(dir)).filter((n) => NAME_RE.test(n));
  const stats = await Promise.all(
    names.map(async (n) => {
      const s = await fs.stat(path.join(dir, n));
      return {
        filename: n,
        size: s.size,
        mtimeMs: s.mtimeMs,
        createdAt: s.mtime.toISOString(),
      };
    })
  );
  return stats.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
}

// Remove backups beyond the count limit or older than the day limit.
async function applyRetention(dir) {
  const { keepCount, keepDays } = retentionConfig();
  const files = await listBackups(dir);
  const now = Date.now();
  const deleted = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ageDays = (now - f.mtimeMs) / 86_400_000;
    const beyondCount = keepCount > 0 && i >= keepCount;
    const tooOld = keepDays > 0 && ageDays > keepDays;
    if (beyondCount || tooOld) {
      await fs.unlink(path.join(dir, f.filename)).catch(() => {});
      deleted.push(f.filename);
    }
  }
  return deleted;
}

function runPgDump(filepath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-U', process.env.DB_ADMIN_USER,
      '-h', process.env.DB_HOST || '127.0.0.1',
      '-p', String(process.env.DB_PORT || 5432),
      '-Fc', // custom format
      '-f', filepath,
      process.env.DB_NAME,
    ];
    const child = spawn(PG_DUMP, args, {
      env: { ...process.env, PGPASSWORD: process.env.DB_ADMIN_PASSWORD },
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) =>
      reject(new Error(`Failed to launch pg_dump: ${err.message}`))
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `pg_dump exited with code ${code}`));
    });
  });
}

// Timestamped, filesystem-safe backup filename.
function makeFilename() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `backup_${stamp}.dump`;
}

router.post('/create', async (_req, res) => {
  if (backupInProgress) {
    return res
      .status(409)
      .json({ error: 'A backup is already in progress. Please wait.' });
  }
  backupInProgress = true;
  const dir = backupDir();
  const filename = makeFilename();
  const filepath = path.join(dir, filename);
  try {
    await fs.mkdir(dir, { recursive: true });
    await runPgDump(filepath);
    const s = await fs.stat(filepath);
    const pruned = await applyRetention(dir);
    res.json({
      filename,
      size: s.size,
      createdAt: s.mtime.toISOString(),
      pruned,
    });
  } catch (err) {
    // Clean up a partial/failed dump file.
    await fs.unlink(filepath).catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    backupInProgress = false;
  }
});

router.get('/list', async (_req, res, next) => {
  try {
    res.json({
      backups: await listBackups(backupDir()),
      inProgress: backupInProgress,
      retention: retentionConfig(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/download/:filename', (req, res) => {
  const name = safeName(req.params.filename);
  if (!name) return res.status(400).json({ error: 'Invalid filename' });
  res.download(path.join(backupDir(), name), name, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Not found' });
  });
});

router.delete('/:filename', async (req, res) => {
  const name = safeName(req.params.filename);
  if (!name) return res.status(400).json({ error: 'Invalid filename' });
  try {
    await fs.unlink(path.join(backupDir(), name));
    res.json({ deleted: name });
  } catch (err) {
    if (err.code === 'ENOENT')
      return res.status(404).json({ error: 'Backup not found' });
    res.status(500).json({ error: err.message });
  }
});

export default router;
