#!/usr/bin/env node

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  watch,
} from 'node:fs'
import { resolve, relative } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

const color = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

interface SemVer {
  major: number
  minor: number
  patch: number
  prerelease: (string | number)[]
}

function createSemVer(
  major: number,
  minor: number,
  patch: number,
  prerelease: (string | number)[] = []
): SemVer {
  return { major, minor, patch, prerelease }
}

function parsePrerelease(input: string | undefined): (string | number)[] {
  if (!input) return []
  return input
    .split('.')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const numeric = Number(segment)
      return Number.isNaN(numeric) ? segment : numeric
    })
}

function normalizeVersionParts(
  major: string | undefined,
  minor: string | undefined,
  patch: string | undefined
): [number, number, number] {
  return [Number(major ?? 0), Number(minor ?? 0), Number(patch ?? 0)]
}

function parseSemVer(input: string): SemVer | null {
  const trimmed = input.trim()
  const match = trimmed.match(
    /^v?(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?(?:-(?<prerelease>[0-9A-Za-z-.]+))?$/
  )

  if (!match || !match.groups?.['major']) return null

  const [major, minor, patch] = normalizeVersionParts(
    match.groups['major'],
    match.groups['minor'],
    match.groups['patch']
  )

  return createSemVer(
    major,
    minor,
    patch,
    parsePrerelease(match.groups['prerelease'])
  )
}

function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch

  const aPre = a.prerelease
  const bPre = b.prerelease

  if (aPre.length === 0 && bPre.length === 0) return 0
  if (aPre.length === 0) return 1
  if (bPre.length === 0) return -1

  const length = Math.max(aPre.length, bPre.length)
  for (let i = 0; i < length; i++) {
    const aId = aPre[i]
    const bId = bPre[i]
    if (aId === undefined) return -1
    if (bId === undefined) return 1
    if (aId === bId) continue

    const aIsNum = typeof aId === 'number'
    const bIsNum = typeof bId === 'number'

    if (aIsNum && bIsNum) return (aId as number) - (bId as number)
    if (aIsNum) return -1
    if (bIsNum) return 1
    return String(aId).localeCompare(String(bId))
  }
  return 0
}

interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
}

interface TarballMetadata {
  file: string
  version: SemVer
  timestamp: number
}

const homeDirectory = homedir()
const cacheDirectory: string = resolve(homeDirectory, '.config', 'packlink')

if (!existsSync(cacheDirectory)) {
  mkdirSync(cacheDirectory, { recursive: true })
}

function log(msg: string) {
  console.log(`${color.cyan}[packlink]${color.reset} ${msg}`)
}

function logError(msg: string, error?: unknown) {
  console.error(`${color.red}[packlink] error:${color.reset} ${msg}`)
  if (error) console.error(error)
}

function getSafePackageName(packageName: string): string {
  if (packageName.startsWith('@')) {
    return packageName.slice(1).replace(/\//g, '-')
  }
  return packageName
}

function publish(includeAddMessage: boolean = true): void {
  let packageJson: PackageJson

  try {
    packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
    )
  } catch (error) {
    logError('Error reading package.json', error)
    process.exit(1)
  }

  const packageName = packageJson.name
  const packageVersion = packageJson.version

  if (!packageName || !packageVersion) {
    logError("package.json must have both a 'name' and a 'version'")
    process.exit(1)
  }

  const safePackageName = getSafePackageName(packageName)

  try {
    execSync(`pnpm pack --pack-destination "${cacheDirectory}"`, {
      stdio: 'pipe',
    })
  } catch (error) {
    logError('Error running "pnpm pack"', error)
    process.exit(1)
  }

  const originalTarballName = `${safePackageName}-${packageVersion}.tgz`
  const originalTarballPath = resolve(cacheDirectory, originalTarballName)

  if (!existsSync(originalTarballPath)) {
    logError(`Tarball not found at destination: ${originalTarballName}`)
    process.exit(1)
  }

  // Remove existing tarballs for this specific version to keep cache clean
  const existingTarballs = readdirSync(cacheDirectory).filter((file) =>
    file.startsWith(`${safePackageName}-${packageVersion}-`)
  )
  for (const file of existingTarballs) {
    rmSync(resolve(cacheDirectory, file))
  }

  const timestamp = Date.now()
  const newTarballName = `${safePackageName}-${packageVersion}-${timestamp}.tgz`
  const newTarballPath = resolve(cacheDirectory, newTarballName)

  renameSync(originalTarballPath, newTarballPath)

  log(
    `Published ${color.green}${packageName}@${packageVersion}${color.reset} ${color.dim}(${timestamp})${color.reset}`
  )

  if (includeAddMessage) {
    console.log(
      `${color.dim}Run 'packlink add ${packageName}' in another project to use this build.${color.reset}`
    )
  }
}

function watchPublish(buildDirectory: string): void {
  const directoryToWatch = resolve(process.cwd(), buildDirectory)
  publish()
  log(`Watching "${buildDirectory}" for changes...`)

  let debounceTimeout: NodeJS.Timeout
  try {
    watch(directoryToWatch, { recursive: true }, () => {
      if (debounceTimeout) clearTimeout(debounceTimeout)
      debounceTimeout = setTimeout(() => {
        log(`${color.yellow}Change detected, republishing...${color.reset}`)
        publish(false)
      }, 200)
    })
  } catch (error) {
    logError(`Error watching directory ${directoryToWatch}`, error)
    process.exit(1)
  }
}

function add(packageName: string): void {
  if (!packageName) {
    logError('Usage: packlink add <package-name>')
    process.exit(1)
  }

  const safePackageName = getSafePackageName(packageName)
  const files = readdirSync(cacheDirectory).filter(
    (file) => file.startsWith(`${safePackageName}-`) && file.endsWith('.tgz')
  )

  if (files.length === 0) {
    logError(`No published tarball found for package ${packageName}.`)
    process.exit(1)
  }

  const tarballs = files
    .map((file) => {
      // Format: <safeName>-<version>-<timestamp>.tgz
      // We strip the extension first
      const nameWithoutExt = file.slice(0, -4)
      const inner = nameWithoutExt.slice(safePackageName.length + 1)
      const lastHyphenIndex = inner.lastIndexOf('-')

      if (lastHyphenIndex === -1) return null

      const versionString = inner.substring(0, lastHyphenIndex)
      const timestampString = inner.substring(lastHyphenIndex + 1)
      const version = parseSemVer(versionString)

      if (!version) return null

      return {
        file,
        version,
        timestamp: parseInt(timestampString, 10),
      }
    })
    .filter((tarball): tarball is TarballMetadata => tarball !== null)

  if (tarballs.length === 0) {
    logError(`No valid tarballs found for package ${packageName}.`)
    process.exit(1)
  }

  // Sort by SemVer first, then Timestamp
  tarballs.sort((a, b) => {
    const verDiff = compareSemVer(a.version, b.version)
    if (verDiff !== 0) return verDiff
    return a.timestamp - b.timestamp
  })

  const latest = tarballs[tarballs.length - 1]
  const tarballPath = resolve(cacheDirectory, latest.file)

  if (!existsSync(tarballPath)) {
    logError(`Tarball missing at ${tarballPath}`)
    process.exit(1)
  }

  // Use ~ on unix-like systems to keep the path simple.
  let dependencyPath: string
  if (process.platform === 'win32') {
    dependencyPath = `file:${relative(process.cwd(), tarballPath)}`
  } else {
    dependencyPath = `file:~${tarballPath.slice(homeDirectory.length)}`
  }

  const consumerPackagePath = resolve(process.cwd(), 'package.json')
  let consumerPackageJson: PackageJson
  try {
    consumerPackageJson = JSON.parse(readFileSync(consumerPackagePath, 'utf8'))
  } catch (error) {
    logError('Error reading consumer package.json', error)
    process.exit(1)
  }

  const hasDependency = consumerPackageJson.dependencies?.[packageName]
  if (hasDependency) {
    delete consumerPackageJson.dependencies![packageName]
    writeFileSync(
      consumerPackagePath,
      JSON.stringify(consumerPackageJson, null, 2)
    )
  }
  const action = hasDependency ? 'Updated' : 'Added'

  try {
    // Adding the specific file path forces pnpm to resolve to the new tarball.
    execSync(`pnpm add "${dependencyPath}"`, { stdio: 'pipe' })

    // Check if it's the exact version requested
    const versionStr = `${latest.version.major}.${latest.version.minor}.${latest.version.patch}`
    log(
      `${action} ${color.green}${packageName}@${versionStr}${color.reset} ${color.dim}(${latest.timestamp})${color.reset}`
    )
  } catch (error) {
    logError(`Error running "pnpm add ${dependencyPath}"`, error)
    process.exit(1)
  }
}

function watchAdd(packageName: string): void {
  const safePackageName = getSafePackageName(packageName)
  add(packageName)
  log(
    `Watching cache for updates to ${color.green}${packageName}${color.reset}...`
  )

  let debounceTimeout: NodeJS.Timeout
  try {
    watch(cacheDirectory, { recursive: false }, (_eventType, filename) => {
      if (
        filename &&
        filename.startsWith(`${safePackageName}-`) &&
        filename.endsWith('.tgz')
      ) {
        if (debounceTimeout) clearTimeout(debounceTimeout)
        debounceTimeout = setTimeout(() => {
          log(
            `${color.yellow}New tarball detected, updating dependency...${color.reset}`
          )
          add(packageName)
        }, 200)
      }
    })
  } catch (error) {
    logError(`Error watching cache directory`, error)
    process.exit(1)
  }
}

const args: string[] = process.argv.slice(2)
const command = args[0]

switch (command) {
  case 'publish': {
    const watchArg = args.find((arg) => arg.startsWith('--watch'))
    if (watchArg) {
      let watchDirectory = 'dist'
      if (watchArg.includes('=')) {
        watchDirectory = watchArg.split('=')[1]
      }
      watchPublish(watchDirectory)
    } else {
      publish()
    }
    break
  }
  case 'add': {
    const packageName = args[1]
    if (!packageName) {
      logError('Usage: packlink add <package-name>')
      process.exit(1)
    }
    const watchArg = args.find((arg) => arg.startsWith('--watch'))
    if (watchArg) {
      watchAdd(packageName)
    } else {
      add(packageName)
    }
    break
  }
  default:
    console.log(
      `${color.cyan}packlink${color.reset} - Local package publishing tool`
    )
    console.log('')
    console.log(
      `  ${color.green}publish${color.reset}                      Create and cache a tarball`
    )
    console.log(
      `  ${color.green}publish --watch${color.reset}              Watch "dist" and republish on change`
    )
    console.log(
      `  ${color.green}add <pkg>${color.reset}                    Add local tarball as dependency`
    )
    console.log(
      `  ${color.green}add <pkg> --watch${color.reset}            Watch cache and update dependency`
    )
    console.log('')
    process.exit(0)
}
