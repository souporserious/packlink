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
function publish(includeAddMessage: boolean = true): void {
  let packageJson: PackageJson

  try {
    packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
    )
  } catch (error) {
    console.error('Error reading package.json:', error)
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
  } catch (error) {
    console.error('Error running "pnpm pack":', error)
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

  console.log(`Published ${packageName}@${packageVersion}`)

  if (includeAddMessage) {
    console.log(
      `You can now run 'packlink add ${packageName}' in another project to add this package as a dependency.`
    )
  }
}

/** Watches the specified build directory for changes. */
function watchPublish(buildDirectory: string): void {
  const directoryToWatch = resolve(process.cwd(), buildDirectory)
  publish()
  console.log(`Watching "${buildDirectory}" directory for changes...`)

  let debounceTimeout: NodeJS.Timeout
  try {
    watch(directoryToWatch, { recursive: true }, () => {
      // Debounce to prevent multiple rapid executions
      if (debounceTimeout) {
        clearTimeout(debounceTimeout)
      }
      debounceTimeout = setTimeout(() => {
        console.log(`Change detected, republishing...`)
        publish(false)
      }, 200)
    })
  } catch (error) {
    console.error(`Error watching directory ${directoryToWatch}:`, error)
    process.exit(1)
  }
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
  } catch (error) {
    console.error('Error reading consumer package.json:', error)
    process.exit(1)
  }

  // Remove old version of the package from dependencies otherwise pnpm will error since we delete old versions when publishing
  const hasDependency = consumerPackageJson.dependencies?.[packageName]
  if (hasDependency) {
    delete consumerPackageJson.dependencies![packageName]
    writeFileSync(
      consumerPackagePath,
      JSON.stringify(consumerPackageJson, null, 2)
    )
  }

  try {
    console.log(`Adding dependency...`)
    execSync(`pnpm add ${dependencyPath}`)
  } catch (error) {
    console.error(`Error running "pnpm add ${dependencyPath}":`, error)
    process.exit(1)
  }

  const action = hasDependency ? 'Updated' : 'Added'
  console.log(
    `${action} ${packageName}@${latest.packageVersion} dependency in package.json`
  )
}

/** Watches the cache directory for changes to the tarball of the specified package. */
function watchAdd(packageName: string): void {
  const safePackageName = getSafePackageName(packageName)
  add(packageName)
  console.log(`Watching for changes...`)

  let debounceTimeout: NodeJS.Timeout
  try {
    watch(cacheDirectory, { recursive: false }, (_eventType, filename) => {
      if (
        filename &&
        filename.startsWith(`${safePackageName}-`) &&
        filename.endsWith('.tgz')
      ) {
        if (debounceTimeout) {
          clearTimeout(debounceTimeout)
        }
        debounceTimeout = setTimeout(() => {
          add(packageName)
        }, 200)
      }
    })
  } catch (error) {
    console.error(`Error watching cache directory:`, error)
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
      console.error('Usage: packlink add <package-name>')
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
    console.log('Usage:')
    console.log(
      '  packlink publish                      # Create and cache a tarball of the current package'
    )
    console.log(
      '  packlink publish --watch              # Watch the "dist" directory for changes (or override with --watch=<directory>)'
    )
    console.log(
      '  packlink add <package-name>           # Add the local tarball as a dependency in package.json'
    )
    console.log(
      '  packlink add <package-name> --watch   # Watch the cache for changes to the package tarball and update the dependency'
    )
    process.exit(0)
}
