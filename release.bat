@echo off
rem 公開される本番の画面(リリース版)を確かめるための入口。
rem このファイルをダブルクリックすれば release.ps1 が動く。
rem
rem dev.bat との違い:
rem   dev.bat     … 制作中(draft)の回も表示する。書きながら確認する用
rem   release.bat … 制作中の回は出ない。生徒が実際に見る画面

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release.ps1"
