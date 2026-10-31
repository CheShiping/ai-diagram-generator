$ErrorActionPreference = 'Stop'

Write-Host '=== sql2er verification ==='

foreach ($script in @('typecheck', 'test', 'build')) {
    Write-Host "=== npm run $script ==="
    npm run $script
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Write-Host '=== verification complete ==='
