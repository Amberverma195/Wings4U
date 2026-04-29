$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot

try {
  npx prisma migrate diff `
    --config packages/database/prisma.config.ts `
    --from-config-datasource `
    --to-schema packages/database/prisma/schema.prisma `
    --exit-code
}
finally {
  Pop-Location
}
