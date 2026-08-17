# 授業資料サイトのプレビューを立ち上げるスクリプト。
#
# 使い方:
#   このファイルを右クリック →「PowerShell で実行」
#   または dev.bat をダブルクリック
#
# やること:
#   1. node と npm が入っているか確認する
#   2. 初回だけ npm install する
#   3. npm run check で資料の書き方を検査する(エラーがあっても止めない)
#   4. npm run dev を起動して、ブラウザでプレビューを開く
#
# 止めたい時は、この黒い画面で Ctrl+C を押すか、ウィンドウを閉じる。

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$url = 'http://localhost:4321/Vantan-JuniorHighSchool-Programming/'

function Write-Step($message) {
    Write-Host ''
    Write-Host "==> $message" -ForegroundColor Cyan
}

Write-Host '授業資料サイト プレビュー' -ForegroundColor Green
Write-Host "フォルダ: $PSScriptRoot"

# --- node があるか確認 ---
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Host ''
    Write-Host 'Node.js が見つかりませんでした。' -ForegroundColor Red
    Write-Host 'https://nodejs.org/ja からインストールしてから、もう一度実行してください。'
    Write-Host ''
    Read-Host 'Enterキーで閉じます'
    exit 1
}
Write-Host "Node.js: $(node -v)"

# --- 初回だけ npm install ---
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
    Write-Step '初回セットアップ中です (npm install)。数分かかります…'
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'npm install に失敗しました。' -ForegroundColor Red
        Read-Host 'Enterキーで閉じます'
        exit 1
    }
}

# --- 資料の書き方チェック(失敗しても続行する) ---
Write-Step '資料の書き方をチェックします (npm run check)'
npm run check
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '↑ 直したほうがよい所があります。プレビューはこのまま起動します。' -ForegroundColor Yellow
}

# --- サーバーを起動して、少し待ってからブラウザを開く ---
Write-Step "プレビューを起動します: $url"
Write-Host '止めたい時は Ctrl+C を押してください。' -ForegroundColor DarkGray

Start-Job -ScriptBlock {
    param($openUrl)
    Start-Sleep -Seconds 4
    Start-Process $openUrl
} -ArgumentList $url | Out-Null

npm run dev

Write-Host ''
Write-Host 'プレビューを終了しました。' -ForegroundColor Green
Read-Host 'Enterキーで閉じます'
