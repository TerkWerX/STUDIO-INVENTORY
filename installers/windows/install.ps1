# Installs or updates Studio Inventory to %LOCALAPPDATA%\Studio Inventory.
# Existing inventory data in data\ is always preserved.
$ErrorActionPreference = 'Stop'

$Source = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Target = Join-Path $env:LOCALAPPDATA 'Studio Inventory'
$StartExe = Join-Path $Target 'Studio Inventory.exe'
$StartBat = Join-Path $Target 'Start Studio Inventory.bat'
$StartTarget = $StartExe
$DataDir = Join-Path $Target 'data'
$DataBackup = Join-Path $env:TEMP "studio-inventory-data-backup"

Write-Host "Studio Inventory — Windows installer"
Write-Host "Installing to: $Target"

if (Test-Path $DataDir) {
  Write-Host "Backing up your inventory data…"
  if (Test-Path $DataBackup) { Remove-Item $DataBackup -Recurse -Force }
  Copy-Item $DataDir $DataBackup -Recurse -Force
}

if (Test-Path $Target) {
  Write-Host "Updating existing install…"
  Remove-Item $Target -Recurse -Force
}

New-Item -ItemType Directory -Path $Target -Force | Out-Null
Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force

if (Test-Path $DataBackup) {
  Write-Host "Restoring your inventory data…"
  if (Test-Path $DataDir) { Remove-Item $DataDir -Recurse -Force }
  Copy-Item $DataBackup $DataDir -Recurse -Force
  Remove-Item $DataBackup -Recurse -Force
}

if (-not (Test-Path $StartTarget)) {
  $StartTarget = $StartBat
}

$WshShell = New-Object -ComObject WScript.Shell

$Desktop = [Environment]::GetFolderPath('Desktop')
$DesktopLink = Join-Path $Desktop 'Studio Inventory.lnk'
$Shortcut = $WshShell.CreateShortcut($DesktopLink)
$Shortcut.TargetPath = $StartTarget
$Shortcut.WorkingDirectory = $Target
$Shortcut.Description = 'Studio Inventory — local music gear catalog'
$Shortcut.Save()
Write-Host "Desktop shortcut created."

$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$MenuLink = Join-Path $StartMenu 'Studio Inventory.lnk'
$Shortcut2 = $WshShell.CreateShortcut($MenuLink)
$Shortcut2.TargetPath = $StartTarget
$Shortcut2.WorkingDirectory = $Target
$Shortcut2.Description = 'Studio Inventory — local music gear catalog'
$Shortcut2.Save()
Write-Host "Start Menu shortcut created."

Write-Host ""
Write-Host "Installed. Double-click 'Studio Inventory' on your Desktop to start."
Write-Host "Your data is stored in: $DataDir"

$open = Read-Host "Start Studio Inventory now? (Y/n)"
if ($open -ne 'n' -and $open -ne 'N') {
  Start-Process $StartTarget
}
