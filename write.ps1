# 授業資料エディタを立ち上げるスクリプト。
#
# 使い方:
#   このファイルを右クリック →「PowerShell で実行」
#   または write.bat をダブルクリック
#
# dev.bat / release.bat との違い:
#   write.bat   … 資料を「書く」ための画面(エディタ)を開く
#   dev.bat     … 書いた資料の見え方を確かめる。制作中(draft)の回も表示する
#   release.bat … 生徒が実際に見る画面と同じもの。制作中の回は出ない
#
# エディタで保存すると、src/content/lessons/ の中のファイルが直接書き換わります。
# 書き終わったら、GitHub Desktop などでコミット＆プッシュしてください。
#
# 止めたい時は、この黒い画面で Ctrl+C を押すか、ウィンドウを閉じる。

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$url = 'http://localhost:4321/Vantan-JuniorHighSchool-Programming/editor/'

function Write-Step($message) {
    Write-Host ''
    Write-Host "==> $message" -ForegroundColor Cyan
}

Write-Host '授業資料エディタ' -ForegroundColor Green
Write-Host '（見え方を確かめたい時は dev.bat / release.bat を使ってください）' -ForegroundColor DarkGray
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

# --- サーバーを起動して、少し待ってからエディタを開く ---
Write-Step "エディタを起動します: $url"
Write-Host '保存すると、授業資料のファイルがそのまま書き換わります。' -ForegroundColor DarkGray
Write-Host '止めたい時は Ctrl+C を押してください。' -ForegroundColor DarkGray

Start-Job -ScriptBlock {
    param($openUrl)
    Start-Sleep -Seconds 4
    Start-Process $openUrl
} -ArgumentList $url | Out-Null

npm run dev

Write-Host ''
Write-Host 'エディタを終了しました。' -ForegroundColor Green
Read-Host 'Enterキーで閉じます'
