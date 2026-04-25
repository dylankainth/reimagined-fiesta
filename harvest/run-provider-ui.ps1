# Quick start script for Provider UI
Write-Host "Starting Harvest Provider UI..." -ForegroundColor Green

Set-Location provider-ui

# Check if electron is installed
if (-not (Test-Path "node_modules\.bin\electron.cmd")) {
    Write-Host "Installing Electron..." -ForegroundColor Yellow
    npm install electron --save-dev
}

# Run with the simplified main file
Write-Host "Launching Provider UI..." -ForegroundColor Cyan
.\node_modules\.bin\electron simple-main.js