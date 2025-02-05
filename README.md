# packlink

**packlink** is a minimal local package publishing tool for [pnpm](https://pnpm.io/) that allows you to:

- **Publish** a package locally by creating a tarball with `pnpm pack` and storing it in a cache directory.
- **Add** a locally published package to another project's dependencies by updating its `package.json` with the cached local file reference.

This tool is useful for testing package changes locally without publishing to a remote registry.

## Features

- **Local Publishing:** Creates a tarball of your package using `pnpm pack` and stores it under `~/.config/packlink/<package-name>-<version>.tgz`.
- **Local Dependency Linking:** Updates the consumer project's `package.json` to reference the local tarball.
- **Simple and Minimal:** Focuses on basic local publishing functionality without added complexity.

## Usage

You can run **packlink** directly with:

```bash
pnpm dlx packlink <command>
```

Or alternatively, install it globally and run it as `packlink`:

```bash
pnpm install -g packlink
packlink <command>
```

## Commands

### `publish`

Publishes a package locally by creating a tarball with `pnpm pack` and storing it in a cache directory.

```bash
packlink publish
```

### `add <package-name>`

Adds a locally published package to another project's dependencies by updating its `package.json` with cached local file reference.

```bash
packlink add <package-name>
```

## License

[MIT](/LICENSE.md) © [souporserious](https://souporserious.com/)
