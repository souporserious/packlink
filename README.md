# packlink

**packlink** is a minimal local package publishing tool for [pnpm](https://pnpm.io/) that allows you to:

- **Publish** a package locally by creating a tarball with `pnpm pack` and storing it in a cache directory.
- **Add** a locally published package to another project's dependencies by updating its `package.json` with the local tarball reference.

This tool is useful for testing package changes locally without publishing to a remote registry. It's most useful within monorepos managed by pnpm workspaces that use local package versions like `catalog:` and `workspace:*`.

## Features

- **Local Publishing:** Creates a tarball of your package using `pnpm pack` and stores it under `~/.config/packlink/<package-name>-<version>-<timestamp>.tgz`.
- **Local Dependency Linking:** Updates the consumer project's `package.json` to reference the local tarball.
- **Auto-Watching:** Republish or readd packages automatically when changes are detected.
- **Simple and Minimal:** Focuses on local publishing without added complexity and zero dependencies.

## Installation

You can run `packlink` directly via `pnpm dlx`:

```bash
pnpm dlx packlink <command>
```

Or alternatively, install it globally:

```bash
pnpm install -g packlink
packlink <command>
```

## Commands

### `publish`

Publishes a package locally by creating a tarball with `pnpm pack` and storing it in your local cache directory (`~/.config/packlink/<package-name>-<version>-<timestamp>.tgz`).

```bash
packlink publish
```

#### Watching for package changes

Use `--watch` to watch for changes in your build directory (default is `dist`). Whenever a file in that directory changes, **packlink** will automatically republish. You can optionally specify a different directory to watch:

```bash
packlink publish --watch        # Watch 'dist' by default
packlink publish --watch=lib    # Watch the 'lib' directory instead of 'dist'
```

### `add <package-name>`

Adds a locally published package to another project's dependencies by updating its `package.json` with the local tarball reference:

```bash
packlink add <package-name>
```

#### Watching for tarball updates

Use `--watch` to automatically update the dependency if a new tarball for the specified package is published. **packlink** will watch the cache directory (`~/.config/packlink/`) and re-run the `add` process when a new tarball is published:

```bash
packlink add <package-name> --watch
```

## License

[MIT](/LICENSE.md) © [souporserious](https://souporserious.com/)
