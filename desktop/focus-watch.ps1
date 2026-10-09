# Prints one line "process<TAB>window title<TAB>input" each time the foreground window, or whether a text box
# has the keyboard focus, changes. "input" is 1 when the focused control is a text box, else 0.
# Only the app name, window title and the kind of control are read. Nothing typed is ever captured.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PgForeground {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    public static string Read() {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "\t";
        var sb = new StringBuilder(512);
        GetWindowText(h, sb, 512);
        uint pid; GetWindowThreadProcessId(h, out pid);
        string name = "";
        try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }
        return name + "\t" + sb.ToString().Replace("\t", " ");
    }
}
'@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$browsers = 'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc'
$last = ''
$box = '0'
$tick = 0
while ($true) {
    $window = [PgForeground]::Read()
    if ($tick % 3 -eq 0) {
        $box = '0'
        try {
            $type = [System.Windows.Automation.AutomationElement]::FocusedElement.Current.ControlType.ProgrammaticName
            if ($type -eq 'ControlType.Edit' -or $type -eq 'ControlType.ComboBox') { $box = '1' }
            elseif ($type -eq 'ControlType.Document' -and ($browsers -notcontains ($window -split "`t")[0])) { $box = '1' }
        } catch { }
    }
    $tick++
    $now = $window + "`t" + $box
    if ($now -ne $last) { $last = $now; [Console]::Out.WriteLine($now); [Console]::Out.Flush() }
    Start-Sleep -Milliseconds 100
}
