# 公開される本番の画面（リリース版）を確かめるスクリプト。
#
# 使い方:
#   release.bat をダブルクリック
#
# dev.bat との違い:
#   dev.bat     … 制作中(status: draft)の回も表示する。書きながら確認する用
#   release.bat … 制作中の回は出ない。生徒が実際に見る画面と同じものが出る
#
# やること:
#   1. node と npm が入っているか確認する
#   2. 初回だけ npm install する
#   3. npm run check で資料の書き方を検査する
#   4. 本番と同じようにビルドして、その結果を表示する
#
# 止めたい時は、この黒い画面で Ctrl+C を押すか、ウィンドウを閉じる。

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# dev.bat(4321)と別のポートを使うので、両方同時に立ち上げて見比べられる
$url = 'http://localhost:4322/Vantan-JuniorHighSchool-Programming/'

function Write-Step($message) {
    Write-Host ''
    Write-Host "==> $message" -ForegroundColor Cyan
}

Write-Host '授業資料サイト リリース版プレビュー' -ForegroundColor Green
Write-Host '（制作中の回は出ません。生徒が見るのと同じ画面です）' -ForegroundColor DarkGray
Write-Host "フォルダ: $PSScriptRoot"

# --- node があるか確認 ---
if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
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
    Write-Host '↑ 直したほうがよい所があります。このまま続けます。' -ForegroundColor Yellow
}

# --- 本番と同じようにビルドする ---
Write-Step '本番と同じようにビルドします (npm run build)'
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'ビルドに失敗しました。上のエラーを見て直してください。' -ForegroundColor Red
    Read-Host 'Enterキーで閉じます'
    exit 1
}

# --- ビルド結果を表示 ---
Write-Step "リリース版を表示します: $url"
Write-Host '制作中(draft)の回はここには出ません。' -ForegroundColor DarkGray
Write-Host '止めたい時は Ctrl+C を押してください。' -ForegroundColor DarkGray

Start-Job -ScriptBlock {
    param($openUrl)
    Start-Sleep -Seconds 3
    Start-Process $openUrl
} -ArgumentList $url | Out-Null

npm run preview

Write-Host ''
Write-Host 'プレビューを終了しました。' -ForegroundColor Green
Read-Host 'Enterキーで閉じます'
