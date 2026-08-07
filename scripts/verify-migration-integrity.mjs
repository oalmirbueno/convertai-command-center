#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(scriptPath), '..')
const manifestPath = 'supabase/migration-manifest.sha256'
const baselineExceptionsPath = 'supabase/migration-baseline-exceptions.json'
const bootstrapPath = 'supabase/bootstrap/legacy_prerequisites.sql'
const migrationsDirectory = resolve(repoRoot, 'supabase/migrations')

function fail(message) {
  throw new Error(`migration integrity: ${message}`)
}

export function parseMigrationManifest(text, source = manifestPath) {
  const entries = new Map()
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([0-9a-f]{64})  (supabase\/(?:migrations\/[0-9]{14}_[A-Za-z0-9._-]+\.sql|bootstrap\/legacy_prerequisites\.sql))$/)
    if (!match) fail(`${source}:${index + 1} has an invalid entry`)
    const [, hash, path] = match
    if (entries.has(path)) fail(`${source} contains duplicate path ${path}`)
    entries.set(path, hash)
  }
  if (entries.size === 0) fail(`${source} is empty`)
  return entries
}

export function verifyAppendOnlyManifest(currentEntries, baseEntries) {
  for (const [path, baseHash] of baseEntries) {
    const currentHash = currentEntries.get(path)
    if (!currentHash) fail(`published entry was removed: ${path}`)
    if (currentHash !== baseHash) fail(`published entry changed: ${path}`)
  }

  const baseMigrations = [...baseEntries.keys()]
    .filter(path => path.startsWith('supabase/migrations/'))
    .map(path => path.slice('supabase/migrations/'.length))
    .sort()
  const latestBaseVersion = baseMigrations.at(-1)?.slice(0, 14) ?? ''

  for (const path of currentEntries.keys()) {
    if (baseEntries.has(path)) continue
    if (!path.startsWith('supabase/migrations/')) {
      fail(`new non-migration ledger entry is not allowed: ${path}`)
    }
    const filename = path.slice('supabase/migrations/'.length)
    if (filename.slice(0, 14) <= latestBaseVersion) {
      fail(`new migration is not forward-only: ${filename}`)
    }
  }
}

function parseBaselineExceptions() {
  let document
  try {
    document = JSON.parse(readFileSync(resolve(repoRoot, baselineExceptionsPath), 'utf8'))
  } catch (error) {
    fail(`${baselineExceptionsPath} is missing or invalid JSON`)
  }
  if (document?.version !== 1 || !Array.isArray(document.exceptions)) {
    fail(`${baselineExceptionsPath} has an invalid contract`)
  }

  const exceptions = new Map()
  for (const entry of document.exceptions) {
    if (
      !entry
      || typeof entry !== 'object'
      || typeof entry.path !== 'string'
      || !/^supabase\/migrations\/[0-9]{14}_[A-Za-z0-9._-]+\.sql$/.test(entry.path)
      || !/^[0-9a-f]{64}$/.test(entry.published_sha256 ?? '')
      || !/^[0-9a-f]{64}$/.test(entry.sanitized_sha256 ?? '')
      || !/^supabase\/migrations\/[0-9]{14}_[A-Za-z0-9._-]+\.sql$/.test(entry.forward_fix ?? '')
      || typeof entry.reason !== 'string'
      || entry.reason.trim().length < 20
      || exceptions.has(entry.path)
    ) {
      fail(`${baselineExceptionsPath} contains an invalid exception`)
    }
    exceptions.set(entry.path, entry)
  }
  return exceptions
}

export function verifyInitialBaseline(currentEntries, baseEntries, exceptions) {
  const usedExceptions = new Set()
  for (const [path, publishedHash] of baseEntries) {
    const currentHash = currentEntries.get(path)
    if (!currentHash) fail(`published entry was removed before baseline: ${path}`)
    if (currentHash === publishedHash) continue

    const exception = exceptions.get(path)
    if (
      !exception
      || exception.published_sha256 !== publishedHash
      || exception.sanitized_sha256 !== currentHash
      || !currentEntries.has(exception.forward_fix)
    ) {
      fail(`historical source changed before baseline without an approved sanitization: ${path}`)
    }
    usedExceptions.add(path)
  }

  for (const path of exceptions.keys()) {
    if (!usedExceptions.has(path)) {
      fail(`unused initial-baseline exception: ${path}`)
    }
  }

  const baseMigrations = [...baseEntries.keys()]
    .filter(path => path.startsWith('supabase/migrations/'))
    .map(path => path.slice('supabase/migrations/'.length))
    .sort()
  const latestBaseVersion = baseMigrations.at(-1)?.slice(0, 14) ?? ''
  for (const path of currentEntries.keys()) {
    if (baseEntries.has(path) || path === bootstrapPath) continue
    if (!path.startsWith('supabase/migrations/')) {
      fail(`new non-migration baseline entry is not allowed: ${path}`)
    }
    const filename = path.slice('supabase/migrations/'.length)
    if (filename.slice(0, 14) <= latestBaseVersion) {
      fail(`new migration predates the initial baseline: ${filename}`)
    }
  }

  return { approvedSanitizations: usedExceptions.size }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(resolve(repoRoot, path))).digest('hex')
}

function currentSourcePaths() {
  const migrations = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
    .map(entry => `supabase/migrations/${entry.name}`)
    .sort()
  return [bootstrapPath, ...migrations].sort()
}

function verifyCurrentFiles(entries) {
  const expectedPaths = currentSourcePaths()
  const manifestPaths = [...entries.keys()].sort()
  if (JSON.stringify(expectedPaths) !== JSON.stringify(manifestPaths)) {
    const missing = expectedPaths.filter(path => !entries.has(path))
    const stale = manifestPaths.filter(path => !expectedPaths.includes(path))
    if (missing.length) fail(`manifest is missing: ${missing.join(', ')}`)
    fail(`manifest has stale entries: ${stale.join(', ')}`)
  }
  for (const path of expectedPaths) {
    const actualHash = sha256(path)
    if (entries.get(path) !== actualHash) fail(`SHA-256 mismatch: ${path}`)
  }
}

function readBaseManifest(baseRef) {
  try {
    return execFileSync(
      'git',
      ['show', `${baseRef}:${manifestPath}`],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr)
      : ''
    if (stderr.includes('does not exist') || stderr.includes('exists on disk, but not in')) {
      return null
    }
    throw error
  }
}

function readBaseSourceEntries(baseRef) {
  const output = execFileSync(
    'git',
    [
      'ls-tree', '-r', '--name-only', baseRef, '--',
      'supabase/migrations', bootstrapPath,
    ],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const entries = new Map()
  for (const path of output.split(/\r?\n/).filter(Boolean).sort()) {
    if (
      path !== bootstrapPath
      && !/^supabase\/migrations\/[0-9]{14}_[A-Za-z0-9._-]+\.sql$/.test(path)
    ) continue
    const bytes = execFileSync(
      'git',
      ['show', `${baseRef}:${path}`],
      { cwd: repoRoot, encoding: null, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    entries.set(path, createHash('sha256').update(bytes).digest('hex'))
  }
  if (entries.size === 0) fail(`${baseRef} contains no migration source`)
  return entries
}

export function verifyMigrationIntegrity({ baseRef } = {}) {
  const currentText = readFileSync(resolve(repoRoot, manifestPath), 'utf8')
  const currentEntries = parseMigrationManifest(currentText)
  verifyCurrentFiles(currentEntries)

  if (baseRef) {
    const baseText = readBaseManifest(baseRef)
    if (baseText === null) {
      const initial = verifyInitialBaseline(
        currentEntries,
        readBaseSourceEntries(baseRef),
        parseBaselineExceptions(),
      )
      return {
        files: currentEntries.size,
        baselineInitialized: true,
        approvedSanitizations: initial.approvedSanitizations,
      }
    }
    const baseEntries = parseMigrationManifest(baseText, `${baseRef}:${manifestPath}`)
    verifyAppendOnlyManifest(currentEntries, baseEntries)
  }
  return {
    files: currentEntries.size,
    baselineInitialized: false,
    approvedSanitizations: 0,
  }
}

function parseArgs(argv) {
  const args = { baseRef: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--base-ref') {
      const value = argv[index + 1]
      if (!value) fail('--base-ref requires a Git ref')
      args.baseRef = value
      index += 1
      continue
    }
    fail(`unknown argument ${arg}`)
  }
  return args
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const result = verifyMigrationIntegrity(parseArgs(process.argv.slice(2)))
    const relativeManifest = relative(repoRoot, resolve(repoRoot, manifestPath))
    console.log(
      `${relativeManifest}: ${result.files} source files verified${
        result.baselineInitialized
          ? ` (initial baseline; ${result.approvedSanitizations} approved sanitizations)`
          : ''
      }`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
