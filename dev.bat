@echo off
rem 授業資料サイトのプレビューを立ち上げるための入口。
rem このファイルをダブルクリックすれば dev.ps1 が動く。
rem (PowerShellスクリプトは既定では実行がブロックされることがあるので、
rem  -ExecutionPolicy Bypass を付けてこのファイル経由で起動している)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1"
