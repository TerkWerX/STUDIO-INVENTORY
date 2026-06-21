#!/usr/bin/env node
/**
 * Build a self-contained release folder (with node_modules) for Windows or macOS.
 * Usage: node scripts/package-release.js <win|mac> [outputDir]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const platform = (process.argv[2] || '').toLowerCase();
const outRoot = path.resolve(process.argv[3] || path.join(ROOT, 'dist', `studio-inventory-${platform}`));

if (!['win', 'mac'].includes(platform)) {
  console.error('Usage: node scripts/package-release.js <win|mac> [outputDir]');
  process.exit(1);
}

const COPY = [
  'server.js',
  'db.js',
  'seed.js',
  'package.json',
  'package-lock.json',
  'README.md',
  'MAC.md',
  'LICENSE',
  'start-studio-inventory.bat',
  'start-studio-inventory.sh',
  'lib',
  'public',
  'installers',
];

const SKIP_DIR_NAMES = new Set(['.git', '.github', 'dist', 'photos', 'docs']);

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function writeFile(rel, content) {
  const dest = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, platform === 'win' ? 'utf8' : { encoding: 'utf8', mode: 0o755 });
}

function ensureDataDirs() {
  const dirs = [
    'manual-inbox',
    'backups',
    'uploads',
    path.join('uploads', 'photos'),
    path.join('uploads', 'manuals'),
    path.join('uploads', 'receipts'),
    path.join('uploads', 'software'),
    path.join('uploads', 'software-licenses'),
    path.join('uploads', 'floorplans'),
    path.join('uploads', 'floorplans', 'walls'),
    path.join('uploads', 'wall-photos'),
    path.join('uploads', 'logos'),
  ];
  for (const sub of dirs) {
    const dir = path.join(outRoot, 'data', sub);
    fs.mkdirSync(dir, { recursive: true });
    const keep = path.join(dir, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
  }
}

function copyNodeRuntime() {
  const nodeSrc = process.execPath;
  const runtimeDir = path.join(outRoot, '.runtime');
  const nodeName = platform === 'win' ? 'node.exe' : 'node';
  const nodeDest = path.join(runtimeDir, nodeName);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(nodeSrc, nodeDest);
  if (platform === 'mac') fs.chmodSync(nodeDest, 0o755);
  return path.join('.runtime', nodeName);
}

function findWindowsCsc() {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  return candidates.find(fs.existsSync);
}

function compileWindowsLaunchers() {
  const csc = findWindowsCsc();
  if (!csc) throw new Error('Could not find csc.exe to build Windows launcher EXEs.');

  const src = path.join(outRoot, '.build', 'StudioInventoryLauncher.cs');
  const exe = path.join(outRoot, '.build', 'StudioInventoryLauncher.exe');
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, `
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

class StudioInventoryLauncher {
  const string AppUrl = "http://localhost:3847/";
  const string HealthUrl = "http://127.0.0.1:3847/api/health";

  [STAThread]
  static int Main(string[] args) {
    Application.EnableVisualStyles();
    string exeName = Path.GetFileNameWithoutExtension(Application.ExecutablePath).ToLowerInvariant();
    string root = AppDomain.CurrentDomain.BaseDirectory;
    return exeName.Contains("install") ? RunInstall(root, args) : RunStart(root);
  }

  static int RunStart(string root) {
    if (!ServerIsRunning()) {
      string node = Path.Combine(root, ".runtime", "node.exe");
      string server = Path.Combine(root, "server.js");
      if (!File.Exists(node)) return Error("Missing bundled runtime: " + node);
      if (!File.Exists(server)) return Error("Missing server file: " + server);

      try {
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = node;
        psi.Arguments = Quote(server);
        psi.WorkingDirectory = root;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process.Start(psi);
      } catch (Exception ex) {
        return Error("Could not start Studio Inventory.\\n\\n" + ex.Message);
      }

      for (int i = 0; i < 40 && !ServerIsRunning(); i++) Thread.Sleep(250);
      if (!ServerIsRunning()) {
        return Error("Studio Inventory was launched, but the server did not respond at " + AppUrl + "\\n\\nClose any old Studio Inventory windows and try again.");
      }
    }

    try {
      Process.Start(new ProcessStartInfo(AppUrl) { UseShellExecute = true });
    } catch (Exception ex) {
      return Error("Studio Inventory started, but the browser could not be opened.\\n\\nOpen " + AppUrl + "\\n\\n" + ex.Message);
    }
    return 0;
  }

  static int RunInstall(string root, string[] args) {
    bool silent = HasArg(args, "--silent");
    bool noStart = HasArg(args, "--no-start");
    bool noShortcuts = HasArg(args, "--no-shortcuts");
    string targetOverride = ArgValue(args, "--target");
    string target = !String.IsNullOrWhiteSpace(targetOverride)
      ? Path.GetFullPath(targetOverride)
      : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Studio Inventory");
    string dataDir = Path.Combine(target, "data");
    string backupDir = Path.Combine(Path.GetTempPath(), "studio-inventory-data-backup-" + Guid.NewGuid().ToString("N"));
    string source = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    string targetFull = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

    try {
      if (!File.Exists(Path.Combine(root, "server.js")) || !File.Exists(Path.Combine(root, ".runtime", "node.exe"))) {
        return Error("This installer is missing required files.\\n\\nExtract the entire ZIP first, then run Install Studio Inventory.exe from the extracted folder.");
      }

      if (!silent && MessageBox.Show(
        "Install Studio Inventory to:\\n\\n" + target + "\\n\\nExisting inventory data in that folder will be preserved.",
        "Install Studio Inventory",
        MessageBoxButtons.OKCancel,
        MessageBoxIcon.Information) != DialogResult.OK) {
        return 0;
      }

      if (!String.Equals(source, targetFull, StringComparison.OrdinalIgnoreCase)) {
        if (Directory.Exists(dataDir)) CopyDirectory(dataDir, backupDir);
        if (Directory.Exists(target)) Directory.Delete(target, true);
        Directory.CreateDirectory(target);
        CopyDirectory(root, target);
        if (Directory.Exists(backupDir)) {
          string restoredData = Path.Combine(target, "data");
          if (Directory.Exists(restoredData)) Directory.Delete(restoredData, true);
          CopyDirectory(backupDir, restoredData);
        }
      }

      if (!noShortcuts) CreateShortcuts(target);

      if (silent) return 0;

      DialogResult start = MessageBox.Show(
        "Studio Inventory is installed.\\n\\nDesktop and Start Menu shortcuts were created.\\n\\nStart Studio Inventory now?",
        "Studio Inventory Installed",
        MessageBoxButtons.YesNo,
        MessageBoxIcon.Information);
      if (start == DialogResult.Yes && !noStart) return RunStart(target);
      return 0;
    } catch (Exception ex) {
      return Error("Could not install Studio Inventory.\\n\\nClose Studio Inventory if it is already running, then try again.\\n\\nDetails: " + ex.Message);
    } finally {
      try {
        if (Directory.Exists(backupDir)) Directory.Delete(backupDir, true);
      } catch {}
    }
  }

  static void CopyDirectory(string sourceDir, string destDir) {
    Directory.CreateDirectory(destDir);
    foreach (string dir in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories)) {
      Directory.CreateDirectory(Path.Combine(destDir, dir.Substring(sourceDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)));
    }
    foreach (string file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories)) {
      string rel = file.Substring(sourceDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
      string dest = Path.Combine(destDir, rel);
      Directory.CreateDirectory(Path.GetDirectoryName(dest));
      File.Copy(file, dest, true);
    }
  }

  static void CreateShortcuts(string target) {
    string exe = Path.Combine(target, "Studio Inventory.exe");
    if (!File.Exists(exe)) exe = Path.Combine(target, "Start Studio Inventory.bat");

    string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
    if (!String.IsNullOrWhiteSpace(desktop)) {
      CreateShortcut(Path.Combine(desktop, "Studio Inventory.lnk"), exe, target);
    }

    string startMenu = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
      "Microsoft", "Windows", "Start Menu", "Programs");
    Directory.CreateDirectory(startMenu);
    CreateShortcut(Path.Combine(startMenu, "Studio Inventory.lnk"), exe, target);
  }

  static void CreateShortcut(string linkPath, string targetPath, string workingDirectory) {
    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
    object shell = Activator.CreateInstance(shellType);
    object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
    Type shortcutType = shortcut.GetType();
    shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
    shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDirectory });
    shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "Studio Inventory — local music gear catalog" });
    shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
  }

  static bool ServerIsRunning() {
    try {
      HttpWebRequest req = (HttpWebRequest)WebRequest.Create(HealthUrl);
      req.Timeout = 500;
      using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) {
        return (int)res.StatusCode >= 200 && (int)res.StatusCode < 500;
      }
    } catch {
      return false;
    }
  }

  static string Quote(string value) {
    return "\\\"" + value.Replace("\\\"", "\\\\\\\"") + "\\\"";
  }

  static bool HasArg(string[] args, string name) {
    foreach (string arg in args) {
      if (String.Equals(arg, name, StringComparison.OrdinalIgnoreCase)) return true;
    }
    return false;
  }

  static string ArgValue(string[] args, string name) {
    for (int i = 0; i < args.Length - 1; i++) {
      if (String.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
    }
    return "";
  }

  static int Error(string message) {
    MessageBox.Show(message, "Studio Inventory", MessageBoxButtons.OK, MessageBoxIcon.Error);
    return 1;
  }
}
`, 'utf8');

  const result = spawnSync(csc, [
    '/nologo',
    '/target:winexe',
    '/reference:System.Windows.Forms.dll',
    `/out:${exe}`,
    src,
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Failed to compile Windows launcher EXE.');

  fs.copyFileSync(exe, path.join(outRoot, 'Studio Inventory.exe'));
  fs.copyFileSync(exe, path.join(outRoot, 'Install Studio Inventory.exe'));
  fs.rmSync(path.join(outRoot, '.build'), { recursive: true, force: true });
}

console.log(`Packaging Studio Inventory for ${platform} → ${outRoot}`);

if (fs.existsSync(outRoot)) {
  fs.rmSync(outRoot, { recursive: true, force: true });
}
fs.mkdirSync(outRoot, { recursive: true });

for (const item of COPY) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) {
    console.warn(`  skip missing: ${item}`);
    continue;
  }
  copyRecursive(src, path.join(outRoot, item));
}

console.log('  copying node_modules…');
copyRecursive(path.join(ROOT, 'node_modules'), path.join(outRoot, 'node_modules'));

ensureDataDirs();
const runtimeNode = copyNodeRuntime();

if (platform === 'win') {
  compileWindowsLaunchers();
  writeFile(
    'Start Studio Inventory.bat',
    `@echo off\r\ncd /d "%~dp0"\r\necho Starting Studio Inventory at http://localhost:3847\r\nstart "" "http://localhost:3847"\r\n"%~dp0${runtimeNode}" server.js\r\npause\r\n`
  );
  writeFile(
    'Install Studio Inventory.bat',
    `@echo off\r\ncd /d "%~dp0"\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installers\\windows\\install.ps1"\r\npause\r\n`
  );
  writeFile(
    'README-INSTALL.txt',
    `Studio Inventory — Windows\r\n\r\nPortable (no install):\r\n  1. Extract this ZIP anywhere\r\n  2. Double-click "Studio Inventory.exe"\r\n  3. Your browser opens at http://localhost:3847\r\n\r\nInstall shortcuts (optional):\r\n  Double-click "Install Studio Inventory.exe"\r\n  Creates Start Menu + Desktop shortcuts in %LOCALAPPDATA%\\Studio Inventory\r\n\r\nFallback scripts are included if Windows blocks the launcher:\r\n  Start Studio Inventory.bat\r\n  Install Studio Inventory.bat\r\n\r\nUpdating (keeps your gear, photos, manuals, wall photos, and receipts):\r\n  1. Download the newer release ZIP\r\n  2. Extract it anywhere temporary\r\n  3. Run "Install Studio Inventory.exe" from the new package\r\n  Your data\\ folder is backed up and restored automatically.\r\n\r\nThe app includes its own Node runtime and checks GitHub at startup for updates.\r\n`
  );
} else {
  writeFile(
    'Start Studio Inventory.command',
    `#!/bin/bash\ncd "$(dirname "$0")"\necho "Starting Studio Inventory at http://localhost:3847"\nopen "http://localhost:3847" 2>/dev/null || true\n"./${runtimeNode}" server.js\n`
  );
  writeFile(
    'Install Studio Inventory.command',
    `#!/bin/bash\ncd "$(dirname "$0")"\nbash "./installers/mac/install.sh"\n`
  );
  fs.chmodSync(path.join(outRoot, 'Start Studio Inventory.command'), 0o755);
  fs.chmodSync(path.join(outRoot, 'Install Studio Inventory.command'), 0o755);
  fs.chmodSync(path.join(outRoot, 'start-studio-inventory.sh'), 0o755);
  writeFile(
    'README-INSTALL.txt',
    `Studio Inventory — macOS\r\n\r\nPortable (no install):\r\n  1. Extract this ZIP anywhere\r\n  2. Double-click "Start Studio Inventory.command"\r\n  3. Your browser opens at http://localhost:3847\r\n\r\nInstall to Applications (optional):\r\n  Double-click "Install Studio Inventory.command"\r\n\r\nUpdating (keeps your gear, photos, manuals, wall photos, and receipts):\r\n  1. Download the newer release DMG or ZIP\r\n  2. Run "Install Studio Inventory.command" from the new package\r\n  Your data/ folder is backed up and restored automatically.\r\n\r\nThe app includes its own Node runtime and checks GitHub at startup for updates.\r\n\r\nFirst time: if macOS blocks the script, right-click → Open.\r\nFull guide: MAC.md or https://github.com/TerkWerX/STUDIO-INVENTORY/blob/main/MAC.md\r\n`
  );
}

const version = require(path.join(ROOT, 'package.json')).version;
fs.writeFileSync(path.join(outRoot, 'VERSION.txt'), `${version}\n${platform}\n`);

console.log('Done.');
