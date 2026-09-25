# Installs or updates Studio Inventory to %LOCALAPPDATA%\Studio Inventory.
# Existing inventory data in data\ is always preserved, and updates never copy
# or delete it: the new version is copied next to the install first, then the
# install is renamed aside and data\ is moved (renamed) into the new version.
# Any failure puts the previous install back.
$ErrorActionPreference = 'Stop'

$Source = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Target = Join-Path $env:LOCALAPPDATA 'Studio Inventory'
if ($env:STUDIO_INVENTORY_INSTALL_DIR) { $Target = $env:STUDIO_INVENTORY_INSTALL_DIR }
$Target = [System.IO.Path]::GetFullPath($Target).TrimEnd('\', '/')
$StartExe = Join-Path $Target 'Studio Inventory.exe'
$StartBat = Join-Path $Target 'Start Studio Inventory.bat'
$StartTarget = $StartExe
$DataDir = Join-Path $Target 'data'

Write-Host "Studio Inventory - Windows installer"
Write-Host "Installing to: $Target"

# Rename a folder; never merge into one that already exists. Retries briefly
# because antivirus and search indexing can hold files for a moment.
function Rename-Folder([string]$From, [string]$To) {
  if (Test-Path -LiteralPath $To) { throw "$To already exists." }
  for ($attempt = 1; ; $attempt++) {
    try {
      [System.IO.Directory]::Move($From, $To)
      return
    } catch {
      if ($attempt -ge 20) { throw }
      Start-Sleep -Milliseconds 250
    }
  }
}

if ($Source -ne $Target) {
  if ($Source.StartsWith($Target + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "Run the installer from the extracted download, not from inside $Target." -ForegroundColor Red
    exit 2
  }

  $running = @(Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($Target + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
  })
  if ($running.Count -gt 0) {
    Write-Host "Closing the running copy of Studio Inventory..."
    $running | Stop-Process -Force
    $running | ForEach-Object { $_.WaitForExit(5000) | Out-Null }
  }

  $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $Staging = "$Target.installing-$Stamp"
  $Previous = "$Target.previous-$Stamp"
  $StagedData = Join-Path $Staging 'data'
  $OldData = Join-Path $Previous 'data'
  $Staged = $false
  $SetAside = $false

  try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Target) -Force | Out-Null
    Write-Host "Copying Studio Inventory files..."
    New-Item -ItemType Directory -Path $Staging | Out-Null
    $Staged = $true
    Copy-Item -Path (Join-Path $Source '*') -Destination $Staging -Recurse -Force

    if (Test-Path -LiteralPath $Target) {
      Write-Host "Updating existing install..."
      Rename-Folder $Target $Previous
      $SetAside = $true
      if (Test-Path -LiteralPath $OldData) {
        Write-Host "Moving your inventory data into the new version..."
        if (Test-Path -LiteralPath $StagedData) { Remove-Item -LiteralPath $StagedData -Recurse -Force }
        Rename-Folder $OldData $StagedData
      }
    }

    Rename-Folder $Staging $Target
  } catch {
    Write-Host "The install did not finish: $($_.Exception.Message)" -ForegroundColor Red
    try {
      if ($SetAside) {
        if (-not (Test-Path -LiteralPath $OldData) -and (Test-Path -LiteralPath $StagedData)) {
          Rename-Folder $StagedData $OldData
        }
        Rename-Folder $Previous $Target
      }
      if ($Staged -and (Test-Path -LiteralPath $Staging)) { Remove-Item -LiteralPath $Staging -Recurse -Force }
      Write-Host "Nothing was changed. Close Studio Inventory if it is running, then try again."
    } catch {
      $where = Join-Path $Target 'data'
      if (Test-Path -LiteralPath $OldData) { $where = $OldData }
      elseif (Test-Path -LiteralPath $StagedData) { $where = $StagedData }
      Write-Host "Your inventory data was not deleted. It is in: $where" -ForegroundColor Yellow
    }
    exit 1
  }

  if ($SetAside) {
    Remove-Item -LiteralPath $Previous -Recurse -Force -ErrorAction SilentlyContinue
  }
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
$Shortcut.Description = 'Studio Inventory - local music gear catalog'
$Shortcut.Save()
Write-Host "Desktop shortcut created."

$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$MenuLink = Join-Path $StartMenu 'Studio Inventory.lnk'
$Shortcut2 = $WshShell.CreateShortcut($MenuLink)
$Shortcut2.TargetPath = $StartTarget
$Shortcut2.WorkingDirectory = $Target
$Shortcut2.Description = 'Studio Inventory - local music gear catalog'
$Shortcut2.Save()
Write-Host "Start Menu shortcut created."

Write-Host ""
Write-Host "Installed. Double-click 'Studio Inventory' on your Desktop to start."
Write-Host "Your data is stored in: $DataDir"

$open = Read-Host "Start Studio Inventory now? (Y/n)"
if ($open -ne 'n' -and $open -ne 'N') {
  Start-Process $StartTarget
}
