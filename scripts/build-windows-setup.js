#!/usr/bin/env node
/**
 * Build a single-file Windows setup EXE from a packaged Studio Inventory folder.
 *
 * Usage:
 *   node scripts/build-windows-setup.js <packageDir> <outputExe>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const packageDir = path.resolve(process.argv[2] || '');
const outputExe = path.resolve(process.argv[3] || '');
const MARKER = Buffer.from('STUDIOINV_PAYLOAD_V1', 'ascii');

if (!packageDir || !outputExe || !fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
  console.error('Usage: node scripts/build-windows-setup.js <packageDir> <outputExe>');
  process.exit(1);
}

function findWindowsCsc() {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  return candidates.find(fs.existsSync);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

function createPayloadZip(payloadZip) {
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $env:PAYLOAD_ZIP) {
  Remove-Item -LiteralPath $env:PAYLOAD_ZIP -Force
}
[System.IO.Compression.ZipFile]::CreateFromDirectory($env:PACKAGE_DIR, $env:PAYLOAD_ZIP, [System.IO.Compression.CompressionLevel]::Optimal, $false)
`;

  run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    ps,
  ], {
    env: {
      ...process.env,
      PACKAGE_DIR: packageDir,
      PAYLOAD_ZIP: payloadZip,
    },
  });
}

function installerSource() {
  return String.raw`
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

class StudioInventorySetup {
  const string AppName = "Studio Inventory";
  const string AppUrl = "http://localhost:3847/";
  const string HealthUrl = "http://127.0.0.1:3847/api/health";
  const string PayloadMarker = "STUDIOINV_PAYLOAD_V1";

  [STAThread]
  static int Main(string[] args) {
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);

    InstallOptions options = InstallOptions.FromArgs(args);
    if (options.Silent) {
      try {
        Install(options, null);
        return 0;
      } catch (Exception ex) {
        Console.Error.WriteLine(ex.ToString());
        return 1;
      }
    }

    Application.Run(new SetupForm(options));
    return 0;
  }

  public static void Install(InstallOptions options, Action<string> status) {
    string tempRoot = Path.Combine(Path.GetTempPath(), "studio-inventory-setup-" + Guid.NewGuid().ToString("N"));
    string payloadDir = Path.Combine(tempRoot, "payload");
    string backupDir = Path.Combine(tempRoot, "data-backup");

    try {
      Status(status, "Extracting installer payload...");
      Directory.CreateDirectory(tempRoot);
      ExtractPayload(payloadDir);

      if (!File.Exists(Path.Combine(payloadDir, "server.js")) || !File.Exists(Path.Combine(payloadDir, ".runtime", "node.exe"))) {
        throw new Exception("The installer payload is incomplete.");
      }

      Status(status, "Preparing install folder...");
      string target = Path.GetFullPath(options.TargetDir);
      string dataDir = Path.Combine(target, "data");
      StopInstalledProcesses(target);

      if (Directory.Exists(dataDir) && options.KeepData) {
        Status(status, "Preserving existing inventory data...");
        CopyDirectory(dataDir, backupDir);
      }

      if (Directory.Exists(target)) {
        Directory.Delete(target, true);
      }
      Directory.CreateDirectory(target);

      Status(status, "Copying Studio Inventory files...");
      CopyDirectory(payloadDir, target);

      if (Directory.Exists(backupDir)) {
        Status(status, "Restoring existing inventory data...");
        string restoredData = Path.Combine(target, "data");
        if (Directory.Exists(restoredData)) Directory.Delete(restoredData, true);
        CopyDirectory(backupDir, restoredData);
      }

      Status(status, "Creating shortcuts...");
      if (options.CreateDesktopShortcut) {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        if (!String.IsNullOrWhiteSpace(desktop)) {
          CreateShortcut(Path.Combine(desktop, "Studio Inventory.lnk"), Path.Combine(target, "Studio Inventory.exe"), target);
        }
      }
      if (options.CreateStartMenuShortcut) {
        string startMenu = Path.Combine(
          Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
          "Microsoft", "Windows", "Start Menu", "Programs");
        Directory.CreateDirectory(startMenu);
        CreateShortcut(Path.Combine(startMenu, "Studio Inventory.lnk"), Path.Combine(target, "Studio Inventory.exe"), target);
      }

      Status(status, "Installation complete.");
      if (options.StartAfterInstall) {
        RunStart(target);
      }
    } finally {
      try {
        if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true);
      } catch {}
    }
  }

  static void ExtractPayload(string payloadDir) {
    string self = Application.ExecutablePath;
    byte[] marker = Encoding.ASCII.GetBytes(PayloadMarker);
    using (FileStream input = File.OpenRead(self)) {
      if (input.Length < marker.Length + 8) {
        throw new Exception("Installer payload marker is missing.");
      }

      byte[] markerRead = new byte[marker.Length];
      input.Seek(-marker.Length, SeekOrigin.End);
      input.Read(markerRead, 0, markerRead.Length);
      for (int i = 0; i < marker.Length; i++) {
        if (markerRead[i] != marker[i]) throw new Exception("Installer payload marker is invalid.");
      }

      byte[] lengthBytes = new byte[8];
      input.Seek(-marker.Length - 8, SeekOrigin.End);
      input.Read(lengthBytes, 0, lengthBytes.Length);
      ulong payloadLength = BitConverter.ToUInt64(lengthBytes, 0);
      long payloadOffset = input.Length - marker.Length - 8 - (long)payloadLength;
      if (payloadOffset < 0) throw new Exception("Installer payload length is invalid.");

      string payloadZip = Path.Combine(Path.GetDirectoryName(payloadDir), "payload.zip");
      input.Seek(payloadOffset, SeekOrigin.Begin);
      using (FileStream output = File.Create(payloadZip)) {
        CopyBytes(input, output, (long)payloadLength);
      }

      Directory.CreateDirectory(payloadDir);
      ZipFile.ExtractToDirectory(payloadZip, payloadDir);
    }
  }

  static void CopyBytes(Stream input, Stream output, long bytesToCopy) {
    byte[] buffer = new byte[1024 * 1024];
    long remaining = bytesToCopy;
    while (remaining > 0) {
      int read = input.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
      if (read <= 0) throw new EndOfStreamException("Unexpected end of installer payload.");
      output.Write(buffer, 0, read);
      remaining -= read;
    }
  }

  static void CopyDirectory(string sourceDir, string destDir) {
    Directory.CreateDirectory(destDir);
    foreach (string dir in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories)) {
      string rel = dir.Substring(sourceDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
      Directory.CreateDirectory(Path.Combine(destDir, rel));
    }
    foreach (string file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories)) {
      string rel = file.Substring(sourceDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
      string dest = Path.Combine(destDir, rel);
      Directory.CreateDirectory(Path.GetDirectoryName(dest));
      File.Copy(file, dest, true);
    }
  }

  static void StopInstalledProcesses(string target) {
    string normalizedTarget = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
    foreach (Process p in Process.GetProcessesByName("node")) {
      try {
        string path = p.MainModule.FileName;
        if (!String.IsNullOrWhiteSpace(path) && path.StartsWith(normalizedTarget, StringComparison.OrdinalIgnoreCase)) {
          p.Kill();
          p.WaitForExit(5000);
        }
      } catch {}
    }
  }

  static int RunStart(string root) {
    if (!ServerIsRunning()) {
      string node = Path.Combine(root, ".runtime", "node.exe");
      string server = Path.Combine(root, "server.js");
      if (!File.Exists(node)) throw new Exception("Missing bundled runtime: " + node);
      if (!File.Exists(server)) throw new Exception("Missing server file: " + server);

      ProcessStartInfo psi = new ProcessStartInfo();
      psi.FileName = node;
      psi.Arguments = Quote(server);
      psi.WorkingDirectory = root;
      psi.UseShellExecute = false;
      psi.CreateNoWindow = true;
      Process.Start(psi);

      for (int i = 0; i < 40 && !ServerIsRunning(); i++) Thread.Sleep(250);
      if (!ServerIsRunning()) throw new Exception("Studio Inventory started, but the server did not respond.");
    }

    Process.Start(new ProcessStartInfo(AppUrl) { UseShellExecute = true });
    return 0;
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

  static string Quote(string value) {
    return "\"" + value.Replace("\"", "\\\"") + "\"";
  }

  static void Status(Action<string> status, string message) {
    if (status != null) status(message);
  }

  public class InstallOptions {
    public string TargetDir;
    public bool KeepData = true;
    public bool CreateDesktopShortcut = true;
    public bool CreateStartMenuShortcut = true;
    public bool StartAfterInstall = true;
    public bool Silent = false;

    public static InstallOptions Default() {
      return new InstallOptions {
        TargetDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Studio Inventory")
      };
    }

    public static InstallOptions FromArgs(string[] args) {
      InstallOptions options = Default();
      options.Silent = HasArg(args, "--silent");
      options.StartAfterInstall = !HasArg(args, "--no-start") && !options.Silent;
      options.CreateDesktopShortcut = !HasArg(args, "--no-desktop") && !HasArg(args, "--no-shortcuts");
      options.CreateStartMenuShortcut = !HasArg(args, "--no-start-menu") && !HasArg(args, "--no-shortcuts");
      options.KeepData = !HasArg(args, "--fresh");
      string target = ArgValue(args, "--target");
      if (!String.IsNullOrWhiteSpace(target)) options.TargetDir = Path.GetFullPath(target);
      return options;
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
  }

  class SetupForm : Form {
    InstallOptions options;
    TextBox targetBox;
    CheckBox desktopBox;
    CheckBox startMenuBox;
    CheckBox keepDataBox;
    CheckBox launchBox;
    Label statusLabel;
    Button installButton;
    Button cancelButton;

    public SetupForm(InstallOptions initial) {
      options = initial;
      Text = "Studio Inventory Setup";
      Width = 620;
      Height = 430;
      FormBorderStyle = FormBorderStyle.FixedDialog;
      MaximizeBox = false;
      StartPosition = FormStartPosition.CenterScreen;
      Font = new Font("Segoe UI", 9F);

      Label title = new Label();
      title.Text = "Install Studio Inventory";
      title.Font = new Font("Segoe UI", 17F, FontStyle.Bold);
      title.Left = 24;
      title.Top = 22;
      title.Width = 540;
      title.Height = 38;
      Controls.Add(title);

      Label body = new Label();
      body.Text = "This setup installs Studio Inventory locally on this computer. Your inventory stays on this machine.";
      body.Left = 26;
      body.Top = 68;
      body.Width = 540;
      body.Height = 42;
      Controls.Add(body);

      Label folderLabel = new Label();
      folderLabel.Text = "Install location";
      folderLabel.Left = 26;
      folderLabel.Top = 124;
      folderLabel.Width = 140;
      Controls.Add(folderLabel);

      targetBox = new TextBox();
      targetBox.Left = 26;
      targetBox.Top = 148;
      targetBox.Width = 450;
      targetBox.Text = options.TargetDir;
      Controls.Add(targetBox);

      Button browse = new Button();
      browse.Text = "Browse...";
      browse.Left = 486;
      browse.Top = 146;
      browse.Width = 90;
      browse.Click += delegate {
        using (FolderBrowserDialog dialog = new FolderBrowserDialog()) {
          dialog.Description = "Choose where to install Studio Inventory";
          dialog.SelectedPath = targetBox.Text;
          if (dialog.ShowDialog(this) == DialogResult.OK) targetBox.Text = dialog.SelectedPath;
        }
      };
      Controls.Add(browse);

      desktopBox = new CheckBox();
      desktopBox.Text = "Create a Desktop shortcut";
      desktopBox.Left = 26;
      desktopBox.Top = 196;
      desktopBox.Width = 260;
      desktopBox.Checked = options.CreateDesktopShortcut;
      Controls.Add(desktopBox);

      startMenuBox = new CheckBox();
      startMenuBox.Text = "Create a Start Menu shortcut";
      startMenuBox.Left = 26;
      startMenuBox.Top = 226;
      startMenuBox.Width = 260;
      startMenuBox.Checked = options.CreateStartMenuShortcut;
      Controls.Add(startMenuBox);

      keepDataBox = new CheckBox();
      keepDataBox.Text = "Keep existing inventory data if Studio Inventory is already installed";
      keepDataBox.Left = 26;
      keepDataBox.Top = 256;
      keepDataBox.Width = 500;
      keepDataBox.Checked = options.KeepData;
      Controls.Add(keepDataBox);

      launchBox = new CheckBox();
      launchBox.Text = "Start Studio Inventory after installing";
      launchBox.Left = 26;
      launchBox.Top = 286;
      launchBox.Width = 320;
      launchBox.Checked = options.StartAfterInstall;
      Controls.Add(launchBox);

      statusLabel = new Label();
      statusLabel.Text = "";
      statusLabel.Left = 26;
      statusLabel.Top = 324;
      statusLabel.Width = 540;
      statusLabel.Height = 28;
      statusLabel.ForeColor = Color.FromArgb(80, 96, 120);
      Controls.Add(statusLabel);

      installButton = new Button();
      installButton.Text = "Install";
      installButton.Left = 392;
      installButton.Top = 354;
      installButton.Width = 88;
      installButton.Height = 32;
      installButton.Click += delegate { InstallClicked(); };
      Controls.Add(installButton);

      cancelButton = new Button();
      cancelButton.Text = "Cancel";
      cancelButton.Left = 488;
      cancelButton.Top = 354;
      cancelButton.Width = 88;
      cancelButton.Height = 32;
      cancelButton.Click += delegate { Close(); };
      Controls.Add(cancelButton);
    }

    void InstallClicked() {
      installButton.Enabled = false;
      cancelButton.Enabled = false;
      try {
        options.TargetDir = targetBox.Text;
        options.CreateDesktopShortcut = desktopBox.Checked;
        options.CreateStartMenuShortcut = startMenuBox.Checked;
        options.KeepData = keepDataBox.Checked;
        options.StartAfterInstall = launchBox.Checked;

        Install(options, delegate(string msg) {
          statusLabel.Text = msg;
          statusLabel.Refresh();
          Application.DoEvents();
        });

        MessageBox.Show(this, "Studio Inventory was installed successfully.", "Studio Inventory Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
        Close();
      } catch (Exception ex) {
        MessageBox.Show(this, "Could not install Studio Inventory.\n\nClose Studio Inventory if it is already running, then try again.\n\nDetails: " + ex.Message, "Studio Inventory Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
        installButton.Enabled = true;
        cancelButton.Enabled = true;
      }
    }
  }
}
`;
}

function compileInstallerStub(stubExe) {
  const csc = findWindowsCsc();
  if (!csc) throw new Error('Could not find csc.exe to build Windows setup EXE.');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-setup-src-'));
  const sourceFile = path.join(tempDir, 'StudioInventorySetup.cs');
  fs.writeFileSync(sourceFile, installerSource(), 'utf8');

  try {
    run(csc, [
      '/nologo',
      '/target:winexe',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Drawing.dll',
      '/reference:System.IO.Compression.dll',
      '/reference:System.IO.Compression.FileSystem.dll',
      `/out:${stubExe}`,
      sourceFile,
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function appendPayload(stubExe, payloadZip) {
  fs.mkdirSync(path.dirname(outputExe), { recursive: true });
  const stub = fs.readFileSync(stubExe);
  const payload = fs.readFileSync(payloadZip);
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(payload.length), 0);
  fs.writeFileSync(outputExe, Buffer.concat([stub, payload, length, MARKER]));
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-setup-build-'));
const stubExe = path.join(tempDir, 'StudioInventorySetup.stub.exe');
const payloadZip = path.join(tempDir, 'payload.zip');

try {
  console.log(`Building Windows setup payload from ${packageDir}`);
  createPayloadZip(payloadZip);
  console.log('Compiling Windows setup stub');
  compileInstallerStub(stubExe);
  console.log(`Writing setup installer → ${outputExe}`);
  appendPayload(stubExe, payloadZip);
  console.log('Done.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
