@echo off
rem 授業資料サイトのプレビューを立ち上げるための入口(書きながら確認する用)。
rem このファイルをダブルクリックすれば dev.ps1 が動く。
rem
rem dev.bat     … 制作中(draft)の回も表示する
rem release.bat … 制作中の回は出ない。生徒が実際に見る画面
rem (PowerShellスクリプトは既定では実行がブロックされることがあるので、
rem  -ExecutionPolicy Bypass を付けてこのファイル経由で起動している)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1"
