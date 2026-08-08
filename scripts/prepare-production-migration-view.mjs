#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
export const defaultRepoRoot = resolve(dirname(scriptPath), '..')

const productionManifestPath = 'supabase/production-migration-baseline.json'
const baselineExceptionsPath = 'supabase/migration-baseline-exceptions.json'
const migrationManifestPath = 'supabase/migration-manifest.sha256'
const bootstrapPath = 'supabase/bootstrap/legacy_prerequisites.sql'
const migrationPathPattern = /^supabase\/migrations\/([0-9]{14})_([A-Za-z0-9._-]+)\.sql$/
const migrationFilenamePattern = /^([0-9]{14})_([A-Za-z0-9._-]+)\.sql$/
const versionPattern = /^[0-9]{14}$/
const sha256Pattern = /^[0-9a-f]{64}$/
const statementSeparator = '\x1e'

function fail(message) {
  throw new Error(`production migration view: ${message}`)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertExactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} has an invalid contract`)
  }
}

function assertNonEmptyString(value, label, minimum = 1) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < minimum) {
    fail(`${label} must be a non-empty, trimmed string`)
  }
}

function assertVersion(value, label) {
  if (typeof value !== 'string' || !versionPattern.test(value)) {
    fail(`${label} must be a 14-digit version`)
  }
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`)
  }
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(`${label} is missing or invalid JSON`)
  }
}

function resolveRepositoryFile(repoRoot, relativePath, pattern, label) {
  if (typeof relativePath !== 'string' || !pattern.test(relativePath)) {
    fail(`${label} has an invalid repository path`)
  }
  return resolve(repoRoot, relativePath)
}

/**
 * Parse RFC 4180-style CSV without weakening quoted-field handling. The
 * Supabase CLI emits a header and CRLF today, but accepting LF, CRLF, a BOM,
 * escaped quotes, and embedded newlines keeps the reader deterministic across
 * supported runners.
 */
export function parseCsv(input, source = 'CSV') {
  if (typeof input !== 'string') fail(`${source} must be UTF-8 text`)
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input
  const rows = []
  let row = []
  let field = ''
  let state = 'unquoted'
  let fieldStarted = false

  const finishField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
    state = 'unquoted'
  }
  const finishRow = () => {
    finishField()
    rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (state === 'quoted') {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          state = 'after-quote'
        }
      } else {
        field += character
      }
      continue
    }

    if (state === 'after-quote') {
      if (character === ',') {
        finishField()
        continue
      }
      if (character === '\n' || character === '\r') {
        if (character === '\r' && text[index + 1] === '\n') index += 1
        finishRow()
        continue
      }
      fail(`${source} has an unexpected character after a closing quote`)
    }

    if (character === '"') {
      if (fieldStarted || field.length > 0) {
        fail(`${source} has a quote inside an unquoted field`)
      }
      state = 'quoted'
      fieldStarted = true
      continue
    }
    if (character === ',') {
      finishField()
      continue
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      finishRow()
      continue
    }
    field += character
    fieldStarted = true
  }

  if (state === 'quoted') fail(`${source} has an unterminated quoted field`)
  if (fieldStarted || field.length > 0 || row.length > 0 || state === 'after-quote') {
    finishRow()
  }
  return rows
}

export function parseRemoteLedgerCsv(input, source = 'remote migration ledger CSV') {
  const rows = parseCsv(input, source)
  if (rows.length === 0) fail(`${source} is empty`)
  const expectedHeader = [
    'remote_version',
    'remote_name',
    'remote_statements_sha256',
  ]
  if (JSON.stringify(rows[0]) !== JSON.stringify(expectedHeader)) {
    fail(`${source} has an invalid header`)
  }

  const entries = []
  const versions = new Set()
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (row.length !== 3) fail(`${source}:${index + 1} must contain exactly 3 fields`)
    const [remoteVersion, remoteName, remoteStatementsSha256] = row
    assertVersion(remoteVersion, `${source}:${index + 1} remote_version`)
    if (typeof remoteName !== 'string' || /[\u0000-\u001f\u007f]/.test(remoteName)) {
      fail(`${source}:${index + 1} remote_name contains control characters`)
    }
    assertHash(remoteStatementsSha256, `${source}:${index + 1} remote_statements_sha256`)
    if (versions.has(remoteVersion)) {
      fail(`${source} contains duplicate version ${remoteVersion}`)
    }
    if (entries.length > 0 && entries.at(-1).remoteVersion >= remoteVersion) {
      fail(`${source} versions must be strictly increasing`)
    }
    versions.add(remoteVersion)
    entries.push({ remoteVersion, remoteName, remoteStatementsSha256 })
  }
  return entries
}

function isIdentifierCharacter(character) {
  return character === '_' || character === '$' || /[\p{L}\p{N}]/u.test(character)
}

function previousCodePoint(text) {
  return Array.from(text).at(-1) ?? ''
}

function isBeginAtomic(sql, tokenStart, index) {
  const current = sql.slice(tokenStart, index + 1)
  const atomicOffset = current.length - 'ATOMIC'.length
  if (atomicOffset < 0 || current.slice(atomicOffset).toUpperCase() !== 'ATOMIC') return false
  if (atomicOffset > 0 && isIdentifierCharacter(previousCodePoint(current.slice(0, atomicOffset)))) {
    return false
  }
  const prefix = current.slice(0, atomicOffset).replace(/\s+$/u, '')
  const beginOffset = prefix.length - 'BEGIN'.length
  if (beginOffset < 0 || prefix.slice(beginOffset).toUpperCase() !== 'BEGIN') return false
  return beginOffset === 0
    || !isIdentifierCharacter(previousCodePoint(prefix.slice(0, beginOffset)))
}

function nextSqlState(state, character, sql, index, tokenStart) {
  if (state.type === 'ready') {
    if (character === '$') return { type: 'tag', offset: index }
    if (character === "'" || character === '"') {
      return { type: 'quote', delimiter: character, escape: false }
    }
    if (character === '-') return { type: 'comment-probe' }
    if (character === '/') return { type: 'block', depth: 0 }
    if (character === '\\') return { type: 'escape' }
    if (character === ';') return null
    if (character === '(') {
      return { type: 'atomic', previous: state, delimiter: ')' }
    }
    if ((character === 'c' || character === 'C') && isBeginAtomic(sql, tokenStart, index)) {
      return { type: 'atomic', previous: state, delimiter: 'END' }
    }
    return state
  }

  if (state.type === 'comment-probe') {
    if (character === '-') return { type: 'dollar', delimiter: '\n' }
    return nextSqlState({ type: 'ready' }, character, sql, index, tokenStart)
  }

  if (state.type === 'block') {
    const window = sql.slice(index - 1, index + 1)
    if (window === '/*') {
      state.depth += 1
      return state
    }
    if (state.depth === 0) {
      return nextSqlState({ type: 'ready' }, character, sql, index, tokenStart)
    }
    if (window === '*/') {
      state.depth -= 1
      if (state.depth === 0) return { type: 'ready' }
    }
    return state
  }

  if (state.type === 'quote') {
    if (state.escape) {
      if (character === state.delimiter) {
        state.escape = false
        return state
      }
      return nextSqlState({ type: 'ready' }, character, sql, index, tokenStart)
    }
    if (character === state.delimiter) state.escape = true
    return state
  }

  if (state.type === 'tag') {
    if (character === '$') {
      return { type: 'dollar', delimiter: sql.slice(state.offset, index + 1) }
    }
    if (character === '_' || /[\p{L}\p{N}]/u.test(character)) return state
    return nextSqlState({ type: 'ready' }, character, sql, index, tokenStart)
  }

  if (state.type === 'dollar') {
    const offset = index + 1 - state.delimiter.length
    if (offset >= tokenStart && sql.slice(offset, index + 1) === state.delimiter) {
      return { type: 'ready' }
    }
    return state
  }

  if (state.type === 'escape') return { type: 'ready' }

  if (state.type === 'atomic') {
    const next = nextSqlState(state.previous, character, sql, index, tokenStart)
    if (next !== null) state.previous = next
    if (state.previous.type === 'ready') {
      const offset = index + 1 - state.delimiter.length
      if (
        offset >= tokenStart
        && sql.slice(offset, index + 1).toUpperCase() === state.delimiter.toUpperCase()
      ) {
        return { type: 'ready' }
      }
    }
    return state
  }

  fail('internal SQL tokenizer state is invalid')
}

function trimSupabaseStatement(token) {
  return token.replace(/;+$/u, '').trim()
}

/**
 * JavaScript port of parser.SplitAndTrim from Supabase CLI v2.109.1. The
 * migration ledger stores this statement array, so its exact separator-aware
 * representation (rather than a raw file hash) is required for rerun checks.
 */
export function splitSupabaseStatements(sql) {
  if (typeof sql !== 'string') fail('SQL source must be UTF-8 text')
  const statements = []
  let state = { type: 'ready' }
  let tokenStart = 0

  for (let index = 0; index < sql.length; index += 1) {
    state = nextSqlState(state, sql[index], sql, index, tokenStart)
    if (state === null) {
      const statement = trimSupabaseStatement(sql.slice(tokenStart, index + 1))
      if (statement.length > 0) statements.push(statement)
      tokenStart = index + 1
      state = { type: 'ready' }
    }
  }

  if (tokenStart < sql.length) {
    const statement = trimSupabaseStatement(sql.slice(tokenStart))
    if (statement.length > 0) statements.push(statement)
  }
  return statements
}

export function supabaseStatementsSha256(sql) {
  return sha256(Buffer.from(splitSupabaseStatements(sql).join(statementSeparator), 'utf8'))
}

export function parseProductionMigrationManifest(input, source = productionManifestPath) {
  let document
  try {
    document = JSON.parse(input)
  } catch {
    fail(`${source} is invalid JSON`)
  }
  assertExactKeys(
    document,
    [
      'version',
      'cutoff_version',
      'forward_migrations',
      'applied_forward_aliases',
      'remote_legacy_entries',
      'schema_attestations',
      'audit',
    ],
    source,
  )
  if (document.version !== 1) fail(`${source} version must be 1`)
  assertVersion(document.cutoff_version, `${source} cutoff_version`)
  if (!Array.isArray(document.remote_legacy_entries)) {
    fail(`${source} remote_legacy_entries must be an array`)
  }
  if (!Array.isArray(document.forward_migrations)) {
    fail(`${source} forward_migrations must be an array`)
  }
  if (!Array.isArray(document.applied_forward_aliases)) {
    fail(`${source} applied_forward_aliases must be an array`)
  }
  if (!Array.isArray(document.schema_attestations)) {
    fail(`${source} schema_attestations must be an array`)
  }


  document.remote_legacy_entries.forEach((entry, index) => {
    const label = `${source} remote_legacy_entries[${index}]`
    assertExactKeys(
      entry,
      [
        'remote_version',
        'local_path',
        'local_sha256',
        'remote_name',
        'remote_statements_sha256',
        'match_mode',
      ],
      label,
    )
    assertVersion(entry.remote_version, `${label} remote_version`)
    if (!migrationPathPattern.test(entry.local_path)) fail(`${label} local_path is invalid`)
    assertHash(entry.local_sha256, `${label} local_sha256`)
    if (typeof entry.remote_name !== 'string' || /[\u0000-\u001f\u007f]/.test(entry.remote_name)) {
      fail(`${label} remote_name is invalid`)
    }
    assertHash(entry.remote_statements_sha256, `${label} remote_statements_sha256`)
    if (!['exact_statements', 'published_sanitization', 'ledger_marker'].includes(entry.match_mode)) {
      fail(`${label} match_mode is invalid`)
    }
  })

  document.forward_migrations.forEach((entry, index) => {
    const label = `${source} forward_migrations[${index}]`
    assertExactKeys(
      entry,
      ['version', 'path', 'local_sha256', 'remote_name', 'remote_statements_sha256'],
      label,
    )
    assertVersion(entry.version, `${label} version`)
    if (!migrationPathPattern.test(entry.path)) fail(`${label} path is invalid`)
    assertHash(entry.local_sha256, `${label} local_sha256`)
    if (
      typeof entry.remote_name !== 'string'
      || entry.remote_name.length === 0
      || /[\u0000-\u001f\u007f]/.test(entry.remote_name)
    ) {
      fail(`${label} remote_name is invalid`)
    }
    assertHash(entry.remote_statements_sha256, `${label} remote_statements_sha256`)
  })

  document.schema_attestations.forEach((entry, index) => {
    const label = `${source} schema_attestations[${index}]`
    assertExactKeys(
      entry,
      ['local_path', 'local_version', 'local_sha256', 'assertion_id', 'reason'],
      label,
    )
    if (!migrationPathPattern.test(entry.local_path)) fail(`${label} local_path is invalid`)
    assertVersion(entry.local_version, `${label} local_version`)
    assertHash(entry.local_sha256, `${label} local_sha256`)
    if (typeof entry.assertion_id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(entry.assertion_id)) {
      fail(`${label} assertion_id is invalid`)
    }
    assertNonEmptyString(entry.reason, `${label} reason`, 20)
  })

  assertExactKeys(
    document.audit,
    [
      'attestation_query_path',
      'attestation_query_sha256',
      'ledger_query_path',
      'ledger_query_sha256',
      'remote_entry_count',
      'local_pre_cutoff_count',
      'exact_statement_matches',
      'approved_sanitizations',
      'reviewed_ledger_markers',
      'reviewed_at',
    ],
    `${source} audit`,
  )
  for (const key of [
    'remote_entry_count',
    'local_pre_cutoff_count',
    'exact_statement_matches',
    'approved_sanitizations',
    'reviewed_ledger_markers',
  ]) {
    if (!Number.isSafeInteger(document.audit[key]) || document.audit[key] < 0) {
      fail(`${source} audit.${key} must be a non-negative integer`)
    }
  }
  for (const key of ['attestation_query_sha256', 'ledger_query_sha256']) {
    assertHash(document.audit[key], `${source} audit.${key}`)
  }
  for (const key of ['attestation_query_path', 'ledger_query_path']) {
    if (typeof document.audit[key] !== 'string' || !/^supabase\/[A-Za-z0-9._-]+\.sql$/.test(document.audit[key])) {
      fail(`${source} audit.${key} is invalid`)
    }
  }
  if (
    typeof document.audit.reviewed_at !== 'string'
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(document.audit.reviewed_at)
    || Number.isNaN(Date.parse(`${document.audit.reviewed_at}T00:00:00Z`))
  ) {
    fail(`${source} audit.reviewed_at is invalid`)
  }
  return document
}

function parseBaselineExceptions(document, source) {
  assertExactKeys(document, ['version', 'exceptions'], source)
  if (document.version !== 1 || !Array.isArray(document.exceptions)) {
    fail(`${source} has an invalid contract`)
  }
  const exceptions = new Map()
  document.exceptions.forEach((entry, index) => {
    const label = `${source} exceptions[${index}]`
    assertExactKeys(
      entry,
      ['path', 'published_sha256', 'sanitized_sha256', 'forward_fix', 'reason'],
      label,
    )
    if (!migrationPathPattern.test(entry.path)) fail(`${label} path is invalid`)
    if (!migrationPathPattern.test(entry.forward_fix)) fail(`${label} forward_fix is invalid`)
    assertHash(entry.published_sha256, `${label} published_sha256`)
    assertHash(entry.sanitized_sha256, `${label} sanitized_sha256`)
    assertNonEmptyString(entry.reason, `${label} reason`, 20)
    if (entry.published_sha256 === entry.sanitized_sha256) {
      fail(`${label} must describe an actual sanitization`)
    }
    if (exceptions.has(entry.path)) fail(`${source} contains duplicate path ${entry.path}`)
    exceptions.set(entry.path, entry)
  })
  return exceptions
}

function parseChecksumManifest(input, source) {
  const entries = new Map()
  input.split(/\r?\n/u).forEach((rawLine, index) => {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith('#')) return
    const match = line.match(
      /^([0-9a-f]{64})  (supabase\/(?:migrations\/[0-9]{14}_[A-Za-z0-9._-]+\.sql|bootstrap\/legacy_prerequisites\.sql))$/,
    )
    if (!match) fail(`${source}:${index + 1} has an invalid entry`)
    const [, hash, path] = match
    if (entries.has(path)) fail(`${source} contains duplicate path ${path}`)
    entries.set(path, hash)
  })
  if (entries.size === 0) fail(`${source} is empty`)
  return entries
}

function readMigrationSources(sourceDir) {
  if (!existsSync(sourceDir) || !lstatSync(sourceDir).isDirectory()) {
    fail(`migration source directory does not exist: ${sourceDir}`)
  }
  const sources = []
  const versions = new Set()
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) fail(`migration source contains a non-file entry: ${entry.name}`)
    const match = entry.name.match(migrationFilenamePattern)
    if (!match) fail(`migration source contains an invalid filename: ${entry.name}`)
    const [, version, name] = match
    if (versions.has(version)) fail(`migration source contains duplicate version ${version}`)
    versions.add(version)
    const bytes = readFileSync(join(sourceDir, entry.name))
    const sql = bytes.toString('utf8')
    if (!Buffer.from(sql, 'utf8').equals(bytes)) {
      fail(`migration source is not valid UTF-8: ${entry.name}`)
    }
    sources.push({
      version,
      name,
      filename: entry.name,
      relativePath: `supabase/migrations/${entry.name}`,
      bytes,
      sha256: sha256(bytes),
      statementsSha256: supabaseStatementsSha256(sql),
    })
  }
  sources.sort((left, right) => left.version.localeCompare(right.version))
  if (sources.length === 0) fail('migration source directory is empty')
  return sources
}

function validateUnique(items, key, label) {
  const values = new Set()
  for (const item of items) {
    const value = item[key]
    if (values.has(value)) fail(`${label} contains duplicate ${key} ${value}`)
    values.add(value)
  }
}

function compareExactSets(actual, expected, label) {
  const missing = [...expected].filter(value => !actual.has(value)).sort()
  const extra = [...actual].filter(value => !expected.has(value)).sort()
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `${label} is not exact${missing.length ? `; missing ${missing.join(', ')}` : ''}`
      + `${extra.length ? `; unexpected ${extra.join(', ')}` : ''}`,
    )
  }
}

export function loadProductionMigrationPlan({
  repoRoot = defaultRepoRoot,
  sourceDir = resolve(repoRoot, 'supabase/migrations'),
  manifestFile = resolve(repoRoot, productionManifestPath),
  exceptionsFile = resolve(repoRoot, baselineExceptionsPath),
  checksumFile = resolve(repoRoot, migrationManifestPath),
} = {}) {
  repoRoot = resolve(repoRoot)
  sourceDir = resolve(sourceDir)
  manifestFile = resolve(manifestFile)
  exceptionsFile = resolve(exceptionsFile)
  checksumFile = resolve(checksumFile)

  const manifest = parseProductionMigrationManifest(
    readFileSync(manifestFile, 'utf8'),
    productionManifestPath,
  )
  const exceptions = parseBaselineExceptions(
    readJson(exceptionsFile, baselineExceptionsPath),
    baselineExceptionsPath,
  )
  const checksums = parseChecksumManifest(
    readFileSync(checksumFile, 'utf8'),
    migrationManifestPath,
  )
  const sources = readMigrationSources(sourceDir)
  const sourceByPath = new Map(sources.map(source => [source.relativePath, source]))
  const migrationChecksumPaths = new Set(
    [...checksums.keys()].filter(path => path.startsWith('supabase/migrations/')),
  )
  compareExactSets(
    migrationChecksumPaths,
    new Set(sources.map(source => source.relativePath)),
    `${migrationManifestPath} migration coverage`,
  )
  for (const source of sources) {
    if (checksums.get(source.relativePath) !== source.sha256) {
      fail(`local SHA-256 mismatch: ${source.relativePath}`)
    }
  }
  if (!checksums.has(bootstrapPath)) fail(`${migrationManifestPath} is missing ${bootstrapPath}`)
  const bootstrapFile = resolveRepositoryFile(
    repoRoot,
    bootstrapPath,
    /^supabase\/bootstrap\/legacy_prerequisites\.sql$/,
    bootstrapPath,
  )
  if (sha256(readFileSync(bootstrapFile)) !== checksums.get(bootstrapPath)) {
    fail(`local SHA-256 mismatch: ${bootstrapPath}`)
  }

  const legacyEntries = manifest.remote_legacy_entries
  const forwardEntries = manifest.forward_migrations
  const attestations = manifest.schema_attestations
  if (legacyEntries.length !== 96) fail('version 1 requires exactly 96 remote legacy entries')
  if (attestations.length !== 2) fail('version 1 requires exactly 2 schema attestations')
  validateUnique(legacyEntries, 'remote_version', productionManifestPath)
  validateUnique(legacyEntries, 'local_path', productionManifestPath)
  validateUnique(attestations, 'local_path', productionManifestPath)
  validateUnique(attestations, 'local_version', productionManifestPath)
  validateUnique(attestations, 'assertion_id', productionManifestPath)
  validateUnique(forwardEntries, 'version', productionManifestPath)
  validateUnique(forwardEntries, 'path', productionManifestPath)
  for (let index = 1; index < legacyEntries.length; index += 1) {
    if (legacyEntries[index - 1].remote_version >= legacyEntries[index].remote_version) {
      fail(`${productionManifestPath} remote legacy entries must be strictly increasing`)
    }
  }

  const cutoff = manifest.cutoff_version
  for (let index = 1; index < forwardEntries.length; index += 1) {
    if (forwardEntries[index - 1].version >= forwardEntries[index].version) {
      fail(`${productionManifestPath} forward migrations must be strictly increasing`)
    }
  }
  const canonicalForward = sources.filter(source => source.version >= cutoff)
  const forwardMigrations = forwardEntries.map(entry => {
    const source = sourceByPath.get(entry.path)
    if (!source || source.version < cutoff) {
      fail(`forward manifest does not reference a post-cutoff source: ${entry.path}`)
    }
    if (source.version !== entry.version) {
      fail(`forward manifest version does not match its filename: ${entry.path}`)
    }
    if (source.sha256 !== entry.local_sha256 || checksums.get(entry.path) !== entry.local_sha256) {
      fail(`forward local SHA-256 mismatch: ${entry.path}`)
    }
    if (source.name !== entry.remote_name) {
      fail(`forward remote name does not match the Supabase CLI filename name: ${entry.path}`)
    }
    if (source.statementsSha256 !== entry.remote_statements_sha256) {
      fail(`forward statement SHA-256 mismatch: ${entry.path}`)
    }
    return source
  })
  if (forwardMigrations.length === 0) fail('forward migration manifest is empty')
  compareExactSets(
    new Set(forwardEntries.map(entry => entry.path)),
    new Set(canonicalForward.map(source => source.relativePath)),
    'forward migration manifest coverage',
  )
  const forwardPaths = new Set(forwardEntries.map(entry => entry.path))
  const mappedPaths = new Set()
  const usedExceptions = new Set()
  const modeCounts = {
    exact_statements: 0,
    published_sanitization: 0,
    ledger_marker: 0,
  }
  for (const entry of legacyEntries) {
    if (entry.remote_version >= cutoff) {
      fail(`legacy remote version is not before cutoff: ${entry.remote_version}`)
    }
    const source = sourceByPath.get(entry.local_path)
    if (!source || source.version >= cutoff) {
      fail(`legacy mapping does not reference a pre-cutoff source: ${entry.local_path}`)
    }
    if (source.sha256 !== entry.local_sha256 || checksums.get(entry.local_path) !== entry.local_sha256) {
      fail(`legacy local SHA-256 mismatch: ${entry.local_path}`)
    }
    if (entry.match_mode === 'exact_statements') {
      if (entry.local_sha256 !== entry.remote_statements_sha256) {
        fail(`exact statement mapping has different hashes: ${entry.local_path}`)
      }
    } else if (entry.match_mode === 'published_sanitization') {
      const exception = exceptions.get(entry.local_path)
      if (
        !exception
        || exception.published_sha256 !== entry.remote_statements_sha256
        || exception.sanitized_sha256 !== entry.local_sha256
      ) {
        fail(`published sanitization is not exact: ${entry.local_path}`)
      }
      const forwardFix = sourceByPath.get(exception.forward_fix)
      if (!forwardFix || forwardFix.version < cutoff || !forwardPaths.has(exception.forward_fix)) {
        fail(`published sanitization lacks a forward fix: ${entry.local_path}`)
      }
      usedExceptions.add(entry.local_path)
    } else if (entry.local_sha256 === entry.remote_statements_sha256) {
      fail(`ledger marker must document a non-exact statement hash: ${entry.local_path}`)
    }
    mappedPaths.add(entry.local_path)
    modeCounts[entry.match_mode] += 1
  }
  compareExactSets(usedExceptions, new Set(exceptions.keys()), 'approved sanitization coverage')

  const attestedPaths = new Set()
  for (const entry of attestations) {
    const source = sourceByPath.get(entry.local_path)
    if (!source || source.version >= cutoff) {
      fail(`schema attestation does not reference a pre-cutoff source: ${entry.local_path}`)
    }
    if (source.version !== entry.local_version) {
      fail(`schema attestation version does not match its filename: ${entry.local_path}`)
    }
    if (source.sha256 !== entry.local_sha256 || checksums.get(entry.local_path) !== entry.local_sha256) {
      fail(`schema attestation local SHA-256 mismatch: ${entry.local_path}`)
    }
    if (mappedPaths.has(entry.local_path)) {
      fail(`schema-attested migration is also mapped to a remote version: ${entry.local_path}`)
    }
    attestedPaths.add(entry.local_path)
  }

  const preCutoff = sources.filter(source => source.version < cutoff)
  const coveredPreCutoff = new Set([...mappedPaths, ...attestedPaths])
  compareExactSets(
    coveredPreCutoff,
    new Set(preCutoff.map(source => source.relativePath)),
    'pre-cutoff migration coverage',
  )
  const audit = manifest.audit
  if (audit.remote_entry_count !== legacyEntries.length) fail('audit remote entry count is stale')
  if (audit.local_pre_cutoff_count !== preCutoff.length) fail('audit pre-cutoff count is stale')
  if (audit.exact_statement_matches !== modeCounts.exact_statements) {
    fail('audit exact statement count is stale')
  }
  if (audit.approved_sanitizations !== modeCounts.published_sanitization) {
    fail('audit approved sanitization count is stale')
  }
  if (audit.reviewed_ledger_markers !== modeCounts.ledger_marker) {
    fail('audit ledger marker count is stale')
  }
  for (const [pathKey, hashKey] of [
    ['attestation_query_path', 'attestation_query_sha256'],
    ['ledger_query_path', 'ledger_query_sha256'],
  ]) {
    const queryPath = resolveRepositoryFile(
      repoRoot,
      audit[pathKey],
      /^supabase\/[A-Za-z0-9._-]+\.sql$/,
      `${productionManifestPath} audit.${pathKey}`,
    )
    if (sha256(readFileSync(queryPath)) !== audit[hashKey]) {
      fail(`audit query SHA-256 mismatch: ${audit[pathKey]}`)
    }
  }

  const listedVersions = [
    ...legacyEntries.map(entry => entry.remote_version),
    ...forwardMigrations.map(source => source.version),
  ]
  if (new Set(listedVersions).size !== listedVersions.length) {
    fail('production migration versions are not unique')
  }
  listedVersions.sort()

  return {
    repoRoot,
    sourceDir,
    manifest,
    legacyEntries,
    attestations,
    forwardMigrations,
    listedVersions,
  }
}

export function validateRemoteLedger(plan, remoteEntries) {
  if (!plan || !Array.isArray(plan.legacyEntries) || !Array.isArray(plan.forwardMigrations)) {
    fail('production migration plan is invalid')
  }
  if (!Array.isArray(remoteEntries)) fail('remote migration entries must be an array')
  const legacy = plan.legacyEntries
  const attestedVersions = new Set(plan.attestations.map(entry => entry.local_version))
  const recordedAttestation = remoteEntries.find(entry => attestedVersions.has(entry.remoteVersion))
  if (recordedAttestation) {
    fail(`schema-attested version unexpectedly exists in the remote ledger: ${recordedAttestation.remoteVersion}`)
  }
  if (remoteEntries.length < legacy.length) {
    fail(`remote ledger has ${remoteEntries.length} rows; expected at least ${legacy.length}`)
  }
  for (let index = 0; index < legacy.length; index += 1) {
    const expected = legacy[index]
    const actual = remoteEntries[index]
    if (
      actual.remoteVersion !== expected.remote_version
      || actual.remoteName !== expected.remote_name
      || actual.remoteStatementsSha256 !== expected.remote_statements_sha256
    ) {
      fail(`remote legacy ledger mismatch at version ${expected.remote_version}`)
    }
  }

  const appliedForwardRows = remoteEntries.slice(legacy.length)
  if (appliedForwardRows.length > plan.forwardMigrations.length) {
    fail('remote ledger contains more forward migrations than the canonical source')
  }
  for (let index = 0; index < appliedForwardRows.length; index += 1) {
    const actual = appliedForwardRows[index]
    const expected = plan.forwardMigrations[index]
    if (actual.remoteVersion !== expected.version) {
      fail(`remote forward ledger is not a canonical prefix at ${actual.remoteVersion}`)
    }
    if (actual.remoteName !== expected.name) {
      fail(`remote forward name mismatch at version ${expected.version}`)
    }
    if (actual.remoteStatementsSha256 !== expected.statementsSha256) {
      fail(`remote forward statement hash mismatch at version ${expected.version}`)
    }
  }
  return {
    appliedForward: plan.forwardMigrations.slice(0, appliedForwardRows.length),
    pendingForward: plan.forwardMigrations.slice(appliedForwardRows.length),
  }
}

export function createSentinelSql(version) {
  assertVersion(version, 'sentinel version')
  return Buffer.from(
    `-- Generated fail-closed production migration sentinel.\n`
    + `-- Version ${version} must already exist in the audited remote ledger.\n`
    + `DO $production_migration_sentinel$\n`
    + `BEGIN\n`
    + `  RAISE EXCEPTION 'Refusing to execute audited migration sentinel ${version}';\n`
    + `END;\n`
    + `$production_migration_sentinel$;\n`,
    'utf8',
  )
}

function assertEmptyOutputDirectory(outputDir) {
  if (!existsSync(outputDir)) return false
  const stat = lstatSync(outputDir)
  if (!stat.isDirectory()) fail(`output path is not a directory: ${outputDir}`)
  if (readdirSync(outputDir).length > 0) fail(`output directory must be empty: ${outputDir}`)
  return true
}

function writeMigrationView(outputDir, files) {
  const existed = assertEmptyOutputDirectory(outputDir)
  const parent = dirname(outputDir)
  mkdirSync(parent, { recursive: true })
  const staging = mkdtempSync(join(parent, '.production-migration-view-'))
  try {
    const filenames = new Set()
    for (const file of files) {
      if (!migrationFilenamePattern.test(file.filename) || filenames.has(file.filename)) {
        fail(`generated migration filename is invalid or duplicated: ${file.filename}`)
      }
      filenames.add(file.filename)
      writeFileSync(join(staging, file.filename), file.bytes, { flag: 'wx' })
    }
    assertEmptyOutputDirectory(outputDir)
    if (existed) rmdirSync(outputDir)
    renameSync(staging, outputDir)
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true })
    throw error
  }
}

export function buildProductionMigrationView({
  ledgerCsvPath,
  outputDir,
  ...planOptions
}) {
  if (typeof ledgerCsvPath !== 'string' || ledgerCsvPath.length === 0) {
    fail('ledgerCsvPath is required')
  }
  if (typeof outputDir !== 'string' || outputDir.length === 0) fail('outputDir is required')
  ledgerCsvPath = resolve(ledgerCsvPath)
  outputDir = resolve(outputDir)

  const plan = loadProductionMigrationPlan(planOptions)
  const remoteEntries = parseRemoteLedgerCsv(
    readFileSync(ledgerCsvPath, 'utf8'),
    ledgerCsvPath,
  )
  const reconciliation = validateRemoteLedger(plan, remoteEntries)
  const appliedForwardVersions = new Set(
    reconciliation.appliedForward.map(source => source.version),
  )
  const files = plan.legacyEntries.map(entry => ({
    filename: `${entry.remote_version}_production_ledger_sentinel.sql`,
    bytes: createSentinelSql(entry.remote_version),
  }))
  for (const source of plan.forwardMigrations) {
    files.push({
      filename: source.filename,
      bytes: appliedForwardVersions.has(source.version)
        ? createSentinelSql(source.version)
        : source.bytes,
    })
  }
  files.sort((left, right) => left.filename.localeCompare(right.filename))
  writeMigrationView(outputDir, files)
  return {
    aliases: plan.legacyEntries.length,
    appliedForward: reconciliation.appliedForward.length,
    pendingForward: reconciliation.pendingForward.length,
    files: files.length,
  }
}

export function listProductionVersions(options = {}) {
  return loadProductionMigrationPlan(options).listedVersions
}

export function listProductionLedgerEntries(options = {}) {
  const plan = loadProductionMigrationPlan(options)
  return [
    ...plan.legacyEntries.map(entry => ({
      version: entry.remote_version,
      name: entry.remote_name,
      statementsSha256: entry.remote_statements_sha256,
    })),
    ...plan.manifest.forward_migrations.map(entry => ({
      version: entry.version,
      name: entry.remote_name,
      statementsSha256: entry.remote_statements_sha256,
    })),
  ].sort((left, right) => left.version.localeCompare(right.version))
}

function quoteSqlText(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('ledger SQL value contains invalid text')
  }
  return `'${value.replaceAll("'", "''")}'`
}

export function formatProductionLedgerSqlValues(options = {}) {
  return listProductionLedgerEntries(options)
    .map(entry => `(${quoteSqlText(entry.version)},${quoteSqlText(entry.name)},${quoteSqlText(entry.statementsSha256)})`)
    .join(',\n')
}

export function parseArgs(argv) {
  const args = {
    listVersions: false,
    ledgerSqlValues: false,
    ledgerCsvPath: undefined,
    outputDir: undefined,
    repoRoot: defaultRepoRoot,
    sourceDir: undefined,
    manifestFile: undefined,
    exceptionsFile: undefined,
    checksumFile: undefined,
  }
  const valueFlags = new Map([
    ['--ledger-csv', 'ledgerCsvPath'],
    ['--output-dir', 'outputDir'],
    ['--repo-root', 'repoRoot'],
    ['--source-dir', 'sourceDir'],
    ['--manifest-file', 'manifestFile'],
    ['--exceptions-file', 'exceptionsFile'],
    ['--checksum-file', 'checksumFile'],
  ])
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--list-versions') {
      if (seen.has(argument)) fail(`duplicate argument ${argument}`)
      args.listVersions = true
      seen.add(argument)
      continue
    }
    if (argument === '--ledger-sql-values') {
      if (seen.has(argument)) fail(`duplicate argument ${argument}`)
      args.ledgerSqlValues = true
      seen.add(argument)
      continue
    }
    const key = valueFlags.get(argument)
    if (!key) fail(`unknown argument ${argument}`)
    if (seen.has(argument)) fail(`duplicate argument ${argument}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`${argument} requires a value`)
    args[key] = value
    seen.add(argument)
    index += 1
  }

  args.repoRoot = resolve(args.repoRoot)
  args.sourceDir = args.sourceDir
    ? resolve(args.sourceDir)
    : resolve(args.repoRoot, 'supabase/migrations')
  args.manifestFile = args.manifestFile
    ? resolve(args.manifestFile)
    : resolve(args.repoRoot, productionManifestPath)
  args.exceptionsFile = args.exceptionsFile
    ? resolve(args.exceptionsFile)
    : resolve(args.repoRoot, baselineExceptionsPath)
  args.checksumFile = args.checksumFile
    ? resolve(args.checksumFile)
    : resolve(args.repoRoot, migrationManifestPath)

  if (args.listVersions && args.ledgerSqlValues) {
    fail('--list-versions and --ledger-sql-values are mutually exclusive')
  }
  if (args.listVersions || args.ledgerSqlValues) {
    if (args.ledgerCsvPath || args.outputDir) {
      fail('listing modes cannot be combined with --ledger-csv or --output-dir')
    }
  } else if (!args.ledgerCsvPath || !args.outputDir) {
    fail('--ledger-csv and --output-dir are required together')
  }
  if (args.ledgerCsvPath) args.ledgerCsvPath = resolve(args.ledgerCsvPath)
  if (args.outputDir) args.outputDir = resolve(args.outputDir)
  return args
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const planOptions = {
    repoRoot: args.repoRoot,
    sourceDir: args.sourceDir,
    manifestFile: args.manifestFile,
    exceptionsFile: args.exceptionsFile,
    checksumFile: args.checksumFile,
  }
  if (args.listVersions) {
    process.stdout.write(`${listProductionVersions(planOptions).join('\n')}\n`)
    return
  }
  if (args.ledgerSqlValues) {
    process.stdout.write(`${formatProductionLedgerSqlValues(planOptions)}\n`)
    return
  }
  buildProductionMigrationView({
    ...planOptions,
    ledgerCsvPath: args.ledgerCsvPath,
    outputDir: args.outputDir,
  })
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    runCli()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
