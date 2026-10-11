# Default: the right-hand pane, $PaneWidth px wide, full height. -Full: the whole window. -Left N: only the left N px of the window
# (the chat column); -Bottom N: only the bottom N px (the band above the chat box and the chat box). -Left and -Bottom imply -Full.
param([string]$Out, [int]$PaneWidth = 660, [switch]$Full, [int]$Left = 0, [int]$Bottom = 0)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class KW2 { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); public struct RECT { public int L, T, R, B; } }
"@
[KW2]::SetProcessDPIAware() | Out-Null
$p = Get-Process -Name "Claude" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$r = New-Object KW2+RECT
[KW2]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$W = $r.R - $r.L; $H = $r.B - $r.T
$shot = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($shot)
$hdc = $g.GetHdc()
$ok = [KW2]::PrintWindow($p.MainWindowHandle, $hdc, 2)
$g.ReleaseHdc($hdc); $g.Dispose()
if ($Full -or $Left -gt 0 -or $Bottom -gt 0) {
  $cw = if ($Left -gt 0) { [Math]::Min($Left, $W) } else { $W }
  $ch = if ($Bottom -gt 0) { [Math]::Min($Bottom, $H) } else { $H }
  $rect = New-Object System.Drawing.Rectangle 0, ($H - $ch), $cw, $ch
} else {
  $pw = [Math]::Min($PaneWidth, $W)
  $rect = New-Object System.Drawing.Rectangle ($W - $pw), 0, $pw, $H
}
$crop = $shot.Clone($rect, $shot.PixelFormat)
$crop.Save($Out)
Write-Output "ok=$ok iconic=$([KW2]::IsIconic($p.MainWindowHandle)) rect=$($r.L),$($r.T),$($r.R),$($r.B) saved $Out"
