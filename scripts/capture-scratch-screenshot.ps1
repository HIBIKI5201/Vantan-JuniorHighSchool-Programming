param(
    [Parameter(Mandatory=$true)][string]$OutPath,
    [int]$CropTop = -1,
    [int]$CropBottom = 15
)

# Claude in Chrome で操作している Scratch エディタのウィンドウを、
# ブラウザのタブ/URLバーなどを除いた「ページの中身だけ」でスクリーンショットとして保存する。
#
# 前提: 対象の Chrome タブは、他のタブと同じウィンドウに同居していない
#       (「タブを別ウィンドウにする」で切り離し済み)であること。
#       同居していると、実際に画面に映っているタブが自動操作対象と一致しない
#       ことがあり、無関係な画面を誤って撮ってしまう恐れがある。
#
# 使い方:
#   powershell -ExecutionPolicy Bypass -File capture-scratch-screenshot.ps1 -OutPath "out.png"
#
# 詳しい経緯・注意点は docs/chrome-screenshot-workflow.md を参照。

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32ScratchCapture {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int ShowCursor(bool bShow);
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$proc = Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*Scratch*" } | Select-Object -First 1
if (-not $proc) { Write-Error "Scratch を開いている Chrome ウィンドウが見つかりません"; exit 1 }

$hwnd = $proc.MainWindowHandle
[Win32ScratchCapture]::ShowWindow($hwnd, 9) | Out-Null
[Win32ScratchCapture]::SetForegroundWindow($hwnd) | Out-Null

# フォアグラウンドに来たことを確認してから撮る。
# 確認せずに撮ると、別のウィンドウ/タブの内容を誤って撮ってしまう可能性がある。
$ok = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 200
    if ([Win32ScratchCapture]::GetForegroundWindow() -eq $hwnd) { $ok = $true; break }
    [Win32ScratchCapture]::SetForegroundWindow($hwnd) | Out-Null
}
if (-not $ok) { Write-Error "Scratch のウィンドウをフォアグラウンドにできませんでした。無関係な画面を撮る可能性があるため中止します"; exit 2 }

Start-Sleep -Milliseconds 200

$rect = New-Object Win32ScratchCapture+RECT
[Win32ScratchCapture]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { Write-Error "ウィンドウサイズの取得に失敗しました"; exit 3 }

# Claude in Chromeの自動操作が、裏でカーソル位置を保持し続けることがあり、
# 位置をずらすだけ(Cursor.Position)だとキャプチャの一瞬前に元へ戻ってしまうことがあった。
# なので位置ではなく「カーソル自体の表示」をキャプチャの間だけ消す。
[Win32ScratchCapture]::ShowCursor($false) | Out-Null
try {
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
    $graphics.Dispose()
} finally {
    [Win32ScratchCapture]::ShowCursor($true) | Out-Null
}

# タブ・URLバー・ブックマークバー・デバッグ中バナーなど、ブラウザ側のUIの高さは
# タブの状態(デバッグバナーの有無など)で変わることがあるので、固定値ではなく
# Scratchの紫ヘッダーの色を上から探して、そこを上端として自動でクロップする。
if ($CropTop -lt 0) {
    $scratchPurple = [System.Drawing.Color]::FromArgb(164, 133, 224)
    $found = -1
    for ($y = 0; $y -lt [Math]::Min(400, $height); $y++) {
        $px = $bitmap.GetPixel([Math]::Min(700, $width - 1), $y)
        $diff = [Math]::Abs($px.R - $scratchPurple.R) + [Math]::Abs($px.G - $scratchPurple.G) + [Math]::Abs($px.B - $scratchPurple.B)
        if ($diff -lt 30) { $found = $y; break }
    }
    if ($found -lt 0) {
        Write-Error "Scratchの紫ヘッダーが見つかりませんでした。ウィンドウがScratchのエディタ画面を表示しているか確認してください"
        $bitmap.Dispose()
        exit 5
    }
    $CropTop = $found
}

$cropHeight = $height - $CropTop - $CropBottom
if ($cropHeight -le 0) { Write-Error "ウィンドウが小さすぎてクロップできません ($width x $height)"; exit 4 }

$cropped = New-Object System.Drawing.Bitmap $width, $cropHeight
$g2 = [System.Drawing.Graphics]::FromImage($cropped)
$g2.DrawImage($bitmap, (New-Object System.Drawing.Rectangle(0,0,$width,$cropHeight)), (New-Object System.Drawing.Rectangle(0,$CropTop,$width,$cropHeight)), [System.Drawing.GraphicsUnit]::Pixel)
$g2.Dispose()
$bitmap.Dispose()

$cropped.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$cropped.Dispose()

if ($env:CAPTURE_DEBUG_RAW) {
    $bitmap2 = New-Object System.Drawing.Bitmap $width, $height
    $g3 = [System.Drawing.Graphics]::FromImage($bitmap2)
    $g3.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
    $g3.Dispose()
    $bitmap2.Save($env:CAPTURE_DEBUG_RAW, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap2.Dispose()
}

Write-Output "Saved: $OutPath (cropped $width x $cropHeight from window $width x $height)"
