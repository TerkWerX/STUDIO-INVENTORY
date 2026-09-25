/**
 * C# shared by the Windows setup EXE (build-windows-setup.js) and the ZIP's
 * "Install Studio Inventory.exe" (package-release.js). Pasted into both classes.
 *
 * An update must never be able to lose the catalog. So the installer never
 * copies or deletes data\: the new version is copied into a sibling folder
 * first, then the installed folder is renamed aside and data\ is moved into the
 * new version (a rename on the same drive: instant, no extra disk space, and it
 * either happens completely or not at all). Any failure puts the previous
 * install back as it was; if even that fails, the error says where the data is.
 *
 * Written for the C# 5 compiler that ships with .NET Framework 4 (csc v4.0.30319).
 */
const SAFE_REPLACE_CS = String.raw`
  static void SafeReplaceInstall(string payloadDir, string target, bool keepData, Action<string> status) {
    target = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    string parent = Path.GetDirectoryName(target);
    if (String.IsNullOrEmpty(parent)) throw new Exception("Choose a folder to install into, not the top of a drive.");
    string source = Path.GetFullPath(payloadDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    if (source.StartsWith(target + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) {
      throw new Exception("The installer is inside the folder it would replace. Extract the download somewhere else, such as Downloads, and run it from there.");
    }
    Directory.CreateDirectory(parent);

    string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
    string staging = target + ".installing-" + stamp;
    string previous = target + ".previous-" + stamp;
    bool setAside = false;
    try {
      SafeStatus(status, "Copying Studio Inventory files...");
      SafeCopyTree(source, staging);
      if (Directory.Exists(target)) {
        SafeStatus(status, "Setting the installed version aside...");
        SafeMove(target, previous);
        setAside = true;
        string oldData = Path.Combine(previous, "data");
        if (keepData && Directory.Exists(oldData)) {
          SafeStatus(status, "Moving your inventory data into the new version...");
          string newData = Path.Combine(staging, "data");
          if (Directory.Exists(newData)) Directory.Delete(newData, true);
          SafeMove(oldData, newData);
        }
      }
      SafeMove(staging, target);
    } catch (Exception ex) {
      throw new Exception(ex.Message + SafeReplaceRollBack(target, staging, previous, setAside), ex);
    }
    if (setAside) {
      try { Directory.Delete(previous, true); } catch { }
    }
  }

  static string SafeReplaceRollBack(string target, string staging, string previous, bool setAside) {
    string stagedData = Path.Combine(staging, "data");
    string oldData = Path.Combine(previous, "data");
    try {
      if (setAside) {
        if (!Directory.Exists(oldData) && Directory.Exists(stagedData)) SafeMove(stagedData, oldData);
        if (Directory.Exists(target)) {
          return "\n\nThe previous version, with your inventory data, is in:\n" + previous;
        }
        SafeMove(previous, target);
      }
      if (Directory.Exists(staging)) Directory.Delete(staging, true);
      return "\n\nNothing was changed" + (setAside ? "; the previous version is still installed." : ".");
    } catch {
      string dataNow = Directory.Exists(oldData) ? oldData
        : Directory.Exists(stagedData) ? stagedData
        : Path.Combine(target, "data");
      return "\n\nYour inventory data was not deleted. It is in:\n" + dataNow;
    }
  }

  static void SafeMove(string from, string to) {
    if (Directory.Exists(to) || File.Exists(to)) throw new IOException(to + " already exists.");
    for (int attempt = 1; ; attempt++) {
      try {
        Directory.Move(from, to);
        return;
      } catch (IOException) {
        if (attempt >= 20) throw;
      } catch (UnauthorizedAccessException) {
        if (attempt >= 20) throw;
      }
      Thread.Sleep(250);
    }
  }

  static void SafeCopyTree(string sourceDir, string destDir) {
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

  // --- Stopping the running app ----------------------------------------------
  // The app is asked to stop itself first (POST /api/shutdown), so it finishes
  // what it is doing and closes the catalog cleanly. Only a copy that does not
  // answer in time is force-stopped.
  const int AppPort = 3847;

  /** Stop the app running from this folder so its files can be moved. Throws if it is busy with a restore. */
  static void StopInstalledProcesses(string target) {
    string result = RequestAppStop(target, false, 30);
    if (result == "stopped" || result == "not-running" && !AppProcessesRunning(target)) return;
    ForceStopProcesses(target);
  }

  /** Last resort: end node.exe processes running from the install folder. */
  static void ForceStopProcesses(string target) {
    string normalizedTarget = NormalizeAppRoot(target) + Path.DirectorySeparatorChar;
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

  /**
   * Ask the app on this computer to stop, if it is the copy installed in
   * target (another copy on the same port is left alone). Returns "stopped",
   * "not-running", "timeout" or "failed". Throws when the app refuses because
   * a restore or import is running.
   */
  static string RequestAppStop(string target, bool allowBackup, int waitSeconds) {
    string root = NormalizeAppRoot(target);
    int status;
    string health = AppHttp("GET", "/api/health", null, 1500, out status);
    if (health == null || status != 200) return "not-running";
    string running = JsonStringField(health, "appRoot");
    if (String.IsNullOrEmpty(running) || !String.Equals(NormalizeAppRoot(running), root, StringComparison.OrdinalIgnoreCase)) {
      return "not-running";
    }
    string answer = AppHttp("POST", "/api/shutdown", allowBackup ? "{}" : "{\"skipBackup\":true}", 5000, out status);
    if (status == 409) {
      throw new Exception(JsonStringField(answer, "error") ?? "Studio Inventory is busy. Try again when it finishes.");
    }
    if (status < 200 || status >= 300) return "failed";
    DateTime until = DateTime.UtcNow.AddSeconds(waitSeconds);
    while (DateTime.UtcNow < until) {
      if (!AppProcessesRunning(target) && AppHttp("GET", "/api/health", null, 500, out status) == null) return "stopped";
      Thread.Sleep(250);
    }
    return "timeout";
  }

  static bool AppProcessesRunning(string target) {
    string prefix = NormalizeAppRoot(target) + Path.DirectorySeparatorChar;
    foreach (Process p in Process.GetProcessesByName("node")) {
      try {
        string path = p.MainModule.FileName;
        if (!p.HasExited && !String.IsNullOrWhiteSpace(path) && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return true;
      } catch {}
    }
    return false;
  }

  static string NormalizeAppRoot(string value) {
    string unified = value.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
    return Path.GetFullPath(unified).TrimEnd(Path.DirectorySeparatorChar);
  }

  /** A tiny HTTP call to the local app. Returns the body, or null when nothing answers. */
  static string AppHttp(string method, string pathAndQuery, string jsonBody, int timeoutMs, out int status) {
    status = 0;
    try {
      HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + AppPort + pathAndQuery);
      req.Method = method;
      req.Timeout = timeoutMs;
      req.ReadWriteTimeout = timeoutMs;
      req.Proxy = null;
      if (jsonBody != null) {
        byte[] bytes = Encoding.UTF8.GetBytes(jsonBody);
        req.ContentType = "application/json";
        req.ContentLength = bytes.Length;
        using (Stream s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
      }
      HttpWebResponse res;
      try {
        res = (HttpWebResponse)req.GetResponse();
      } catch (WebException ex) {
        res = ex.Response as HttpWebResponse;
        if (res == null) return null;
      }
      using (res) {
        status = (int)res.StatusCode;
        using (StreamReader reader = new StreamReader(res.GetResponseStream())) return reader.ReadToEnd();
      }
    } catch {
      return null;
    }
  }

  /** The value of a top-level string field in a small JSON object. */
  static string JsonStringField(string json, string name) {
    if (json == null) return null;
    System.Text.RegularExpressions.Match m = System.Text.RegularExpressions.Regex.Match(
      json, "\"" + name + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
    if (!m.Success) return null;
    return System.Text.RegularExpressions.Regex.Unescape(m.Groups[1].Value);
  }

  static void SafeStatus(Action<string> status, string message) {
    if (status != null) status(message);
  }
`;

module.exports = { SAFE_REPLACE_CS };
