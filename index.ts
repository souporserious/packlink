#!/usr/bin/env node

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { resolve, relative } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
}

interface TarballMetadata {
  file: string
  packageVersion: string
  timestamp: number
}

const homeDirectory = homedir()
const cacheDirectory: string = resolve(homeDirectory, '.config', 'packlink')

if (!existsSync(cacheDirectory)) {
  mkdirSync(cacheDirectory, { recursive: true })
}

/**
 * Converts a package name to a safe string.
 * For example, a scoped package "@scope/package" becomes "scope-package".
 */
function getSafePackageName(packageName: string): string {
  if (packageName.startsWith('@')) {
    return packageName.slice(1).replace(/\//g, '-')
  }
  return packageName
}

/**
 * Compare two semantic version strings.
 * Returns a negative number if a < b, zero if a == b, or a positive number if a > b.
 */
function compareSemanticVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
    const numA = partsA[index] || 0
    const numB = partsB[index] || 0
    if (numA !== numB) {
      return numA - numB
    }
  }
  return 0
}

/** Create a tarball of the current package and store it in the cache directory. */
function publish(): void {
  let packageJson: PackageJson

  try {
    packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
    )
  } catch (err) {
    console.error('Error reading package.json:', err)
    process.exit(1)
  }

  const packageName = packageJson.name
  const packageVersion = packageJson.version

  if (!packageName || !packageVersion) {
    console.error("package.json must have both a 'name' and a 'version'")
    process.exit(1)
  }

  const safePackageName = getSafePackageName(packageName)

  try {
    execSync(`pnpm pack --pack-destination ${cacheDirectory}`)
  } catch (err) {
    console.error('Error running pnpm pack:', err)
    process.exit(1)
  }

  const originalTarballName = `${safePackageName}-${packageVersion}.tgz`
  const originalTarballPath = resolve(cacheDirectory, originalTarballName)

  if (!existsSync(originalTarballPath)) {
    console.error('Tarball not found at destination:', originalTarballName)
    process.exit(1)
  }

  // Remove any existing tarballs with the same name and version.
  const existingTarballs = readdirSync(cacheDirectory).filter((file) =>
    file.startsWith(`${safePackageName}-${packageVersion}-`)
  )
  for (const file of existingTarballs) {
    rmSync(resolve(cacheDirectory, file))
  }

  // Append a timestamp so that pnpm will install the updated version.
  const timestamp = Date.now()
  const newTarballName = `${safePackageName}-${packageVersion}-${timestamp}.tgz`
  const newTarballPath = resolve(cacheDirectory, newTarballName)

  renameSync(originalTarballPath, newTarballPath)

  console.log(
    `Published ${packageName}@${packageVersion} to ${newTarballPath}.\nYou can now run 'packlink add ${packageName}' in another project to add this tarball as a dependency.`
  )
}

/**
 * Add a published package as a dependency in the current project.
 * Searches the cache directory for tarballs matching the package name.
 */
function add(packageName: string): void {
  if (!packageName) {
    console.error('Usage: packlink add <package-name>')
    process.exit(1)
  }

  const safePackageName = getSafePackageName(packageName)
  const files = readdirSync(cacheDirectory).filter(
    (file) => file.startsWith(`${safePackageName}-`) && file.endsWith('.tgz')
  )

  if (files.length === 0) {
    console.error(`No published tarball found for package ${packageName}.`)
    process.exit(1)
  }

  const tarballs = files
    .map((file) => {
      const inner = file.substring(safePackageName.length + 1, file.length - 4) // yields "<packageVersion>-<timestamp>"
      const lastHyphenIndex = inner.lastIndexOf('-')

      if (lastHyphenIndex === -1) {
        // If there is no hyphen, the file does not have a timestamp; skip it.
        return null
      }

      return {
        file,
        packageVersion: inner.substring(0, lastHyphenIndex),
        timestamp: parseInt(inner.substring(lastHyphenIndex + 1), 10),
      }
    })
    .filter(Boolean) as TarballMetadata[]

  if (tarballs.length === 0) {
    console.error(
      `No published tarball with timestamp found for package ${packageName}.`
    )
    process.exit(1)
  }

  tarballs.sort((a, b) => {
    return compareSemanticVersions(a.packageVersion, b.packageVersion)
  })

  const latest = tarballs[tarballs.length - 1]
  const tarballPath = resolve(cacheDirectory, latest.file)

  if (!existsSync(tarballPath)) {
    console.error(`Tarball not found at ${tarballPath}`)
    process.exit(1)
  }

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
  } catch (err) {
    console.error('Error reading consumer package.json:', err)
    process.exit(1)
  }

  consumerPackageJson.dependencies = consumerPackageJson.dependencies || {}
  consumerPackageJson.dependencies[packageName] = dependencyPath

  writeFileSync(
    consumerPackagePath,
    JSON.stringify(consumerPackageJson, null, 2)
  )

  console.log(
    `Added ${packageName}@${latest.packageVersion} to dependencies. Run 'pnpm install' to install the dependency.`
  )
}

const args: string[] = process.argv.slice(2)
const command = args[0]

switch (command) {
  case 'publish':
    publish()
    break
  case 'add':
    add(args[1])
    break
  default:
    console.log('Usage:')
    console.log(
      '  packlink publish               # Create and cache a tarball of the current package'
    )
    console.log(
      '  packlink add <package-name>    # Add the local tarball as a dependency in package.json'
    )
    process.exit(0)
}
