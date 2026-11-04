@echo off
rem Registers a Windows scheduled task that checks for PokeBonk updates every 3 hours.
schtasks /Create /F /TN "PokeBonk Data Update" /SC HOURLY /MO 3 /TR "\"%~dp0update.cmd\" --quiet"
if errorlevel 1 (echo Could not create the task.) else (echo Scheduled: checks every 3 hours. Remove with unschedule.cmd)
pause
