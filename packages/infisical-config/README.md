# @quantum-l9/infisical-config (vendored)

Pinned from Quantum-L9/infisical-config@331ef590. Installed via `file:packages/infisical-config` so hosted `npm ci --ignore-scripts` has a committed `dist/` and never hits GitHub Packages.

See `SOURCE.txt`.

Blank `KEY=` rows (dotenv placeholders, empty Infisical secrets such as
`L9_MEMORY_TOKEN`) are treated as unset: they are deleted before hydrate and
never injected so a real vault or Graphiti alias can backfill a required
secret. A nonempty local value still wins unless `overwrite` is true. Memory
is not optional — blank is not an off switch.
