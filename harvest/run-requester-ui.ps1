# Quick start script for Requester UI  
Write-Host "Starting Harvest Requester UI..." -ForegroundColor Green

Set-Location requester-ui

# Check if electron is installed
if (-not (Test-Path "node_modules\.bin\electron.cmd")) {
    Write-Host "Installing Electron..." -ForegroundColor Yellow
    npm install electron --save-dev
}

# Run with the simplified main file
Write-Host "Launching Requester UI..." -ForegroundColor Cyan
.\node_modules\.bin\electron simple-main.js