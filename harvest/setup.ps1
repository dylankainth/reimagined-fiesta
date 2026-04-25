# Setup script for Harvest applications
Write-Host "Setting up Harvest applications..." -ForegroundColor Green

# Install dependencies for each component
$components = @("shared", "provider", "requester", "provider-ui", "requester-ui")

foreach ($component in $components) {
    if (Test-Path $component) {
        Write-Host "`nInstalling dependencies for $component..." -ForegroundColor Yellow
        Set-Location $component
        npm install
        Set-Location ..
    }
}

Write-Host "`nSetup complete! Use the following commands to run:" -ForegroundColor Green
Write-Host "Provider UI:    cd provider-ui && npm start" -ForegroundColor Cyan
Write-Host "Requester UI:   cd requester-ui && npm start" -ForegroundColor Cyan  
Write-Host "Provider:       cd provider && npm start" -ForegroundColor Cyan
Write-Host "Requester:      cd requester && npm start" -ForegroundColor Cyan