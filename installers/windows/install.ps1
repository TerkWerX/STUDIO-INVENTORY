# Installs Studio Inventory to %LOCALAPPDATA%\Studio Inventory and creates shortcuts.
$ErrorActionPreference = 'Stop'

$Source = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Target = Join-Path $env:LOCALAPPDATA 'Studio Inventory'
$StartBat = Join-Path $Target 'Start Studio Inventory.bat'

Write-Host "Studio Inventory — Windows installer"
Write-Host "Installing to: $Target"

if (Test-Path $Target) {
  Write-Host "Updating existing install…"
  Remove-Item -Recurse -Force $Target
}

New-Item -ItemType Directory -Path $Target -Force | Out-Null
Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force

$WshShell = New-Object -ComObject WScript.Shell

$Desktop = [Environment]::GetFolderPath('Desktop')
$DesktopLink = Join-Path $Desktop 'Studio Inventory.lnk'
$Shortcut = $WshShell.CreateShortcut($DesktopLink)
$Shortcut.TargetPath = $StartBat
$Shortcut.WorkingDirectory = $Target
$Shortcut.Description = 'Studio Inventory — local music gear catalog'
$Shortcut.Save()
Write-Host "Desktop shortcut created."

$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$MenuLink = Join-Path $StartMenu 'Studio Inventory.lnk'
$Shortcut2 = $WshShell.CreateShortcut($MenuLink)
$Shortcut2.TargetPath = $StartBat
$Shortcut2.WorkingDirectory = $Target
$Shortcut2.Description = 'Studio Inventory — local music gear catalog'
$Shortcut2.Save()
Write-Host "Start Menu shortcut created."

Write-Host ""
Write-Host "Installed. Double-click 'Studio Inventory' on your Desktop to start."
Write-Host "Your data will be stored in: $(Join-Path $Target 'data')"

$open = Read-Host "Start Studio Inventory now? (Y/n)"
if ($open -ne 'n' -and $open -ne 'N') {
  Start-Process $StartBat
}