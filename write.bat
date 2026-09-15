@echo off
rem 授業資料エディタを立ち上げるための入口(資料を書く用)。
rem このファイルをダブルクリックすれば write.ps1 が動く。
rem
rem write.bat   … 資料を書く画面(エディタ)を開く
rem dev.bat     … 書いた資料の見え方を確かめる。制作中(draft)の回も表示する
rem release.bat … 生徒が実際に見る画面。制作中の回は出ない
rem (PowerShellスクリプトは既定では実行がブロックされることがあるので、
rem  -ExecutionPolicy Bypass を付けてこのファイル経由で起動している)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0write.ps1"
