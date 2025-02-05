#!/usr/bin/env node

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { resolve, relative } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

interface PackageJson {
  name: string
  version: string
  dependencies?: Record<string, string>
}

const homeDirectory = homedir()
const cacheDirectory: string = resolve(homeDirectory, '.config', 'packlink')

if (!existsSync(cacheDirectory)) {
  mkdirSync(cacheDirectory, { recursive: true })
}

/**
 * Converts a package name to a safe string.
 * For example, a scoped package "@scope/pkg" becomes "scope-pkg".
 */
function getSafeName(packageName: string): string {
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

  const pkgName = packageJson.name
  const pkgVersion = packageJson.version
  if (!pkgName || !pkgVersion) {
    console.error("package.json must have both a 'name' and a 'version'")
    process.exit(1)
  }

  const safeName = getSafeName(pkgName)

  try {
    execSync(`pnpm pack --pack-destination ${cacheDirectory}`)
  } catch (err) {
    console.error('Error running pnpm pack:', err)
    process.exit(1)
  }

  const tarballName = `${safeName}-${pkgVersion}.tgz`
  const tarballPath = resolve(cacheDirectory, tarballName)

  if (!existsSync(tarballPath)) {
    console.error('Tarball not found at destination:', tarballName)
    process.exit(1)
  }

  console.log(
    `Published ${pkgName}@${pkgVersion} to ${tarballPath}.\nYou can now run 'npx packlink add ${pkgName}' in another project to add this tarball as a dependency.`
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

  const safeName = getSafeName(packageName)
  const files = readdirSync(cacheDirectory).filter(
    (file) => file.startsWith(`${safeName}-`) && file.endsWith('.tgz')
  )
  if (files.length === 0) {
    console.error(`No published tarball found for package ${packageName}.`)
    process.exit(1)
  }

  const versions = files
    .map((file) => {
      // Remove the safeName and hyphen, and the .tgz suffix
      // e.g. "<package-name>-1.0.0.tgz" becomes "1.0.0"
      return file.substring(safeName.length + 1, file.length - 4)
    })
    .sort(compareSemanticVersions)
  const latestVersion = versions[versions.length - 1]
  const tarballName = `${safeName}-${latestVersion}.tgz`
  const tarballPath = resolve(cacheDirectory, tarballName)

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

  const consumerPkgPath = resolve(process.cwd(), 'package.json')
  let consumerPkg: PackageJson
  try {
    consumerPkg = JSON.parse(readFileSync(consumerPkgPath, 'utf8'))
  } catch (err) {
    console.error('Error reading consumer package.json:', err)
    process.exit(1)
  }

  consumerPkg.dependencies = consumerPkg.dependencies || {}
  consumerPkg.dependencies[packageName] = dependencyPath

  writeFileSync(consumerPkgPath, JSON.stringify(consumerPkg, null, 2))

  console.log(
    `Added ${packageName}@${latestVersion} to dependencies. Run 'pnpm install' to install the dependency.`
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
