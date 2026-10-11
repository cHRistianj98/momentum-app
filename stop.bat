@echo off
setlocal EnableExtensions

REM ================================================================
REM MOMENTUM - STOP
REM Zatrzymuje TYLKO okna uruchomione przez start.bat
REM i dedykowany kontener PostgreSQL (dane zostaja).
REM Docker Desktop pozostaje wlaczony.
REM ================================================================
set "POSTGRES_CONTAINER=momentum-postgres-5435"
set "PATH=%PATH%;%ProgramFiles%\Docker\Docker\resources\bin"

echo =====================================================
echo                    MOMENTUM STOP
echo =====================================================

REM Identyfikacja unikalnych konsol przez marker w linii polecen.
REM taskkill /T zabija tez procesy potomne (npm/node, Maven/Java).
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*/k*' -and ($_.CommandLine -like '*MOMENTUM_FRONTEND_WINDOW*' -or $_.CommandLine -like '*MOMENTUM_BACKEND_WINDOW*') }; foreach ($x in $p) { Write-Host ('[STOP] Zatrzymuje terminal PID ' + $x.ProcessId); & taskkill.exe /PID $x.ProcessId /T /F }"

REM Dodatkowy wariant dla konsol odnalezionych po tytule.
taskkill /F /T /FI "WINDOWTITLE eq MOMENTUM_FRONTEND_WINDOW" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq MOMENTUM_BACKEND_WINDOW" >nul 2>&1

REM Nie wylaczaj cudzych baz na porcie 5435.
where docker.exe >nul 2>&1
if errorlevel 1 goto :done
docker info >nul 2>&1
if errorlevel 1 goto :done
docker container inspect "%POSTGRES_CONTAINER%" >nul 2>&1
if errorlevel 1 goto :done
echo [POSTGRES] Zatrzymuje kontener %POSTGRES_CONTAINER%...
docker stop "%POSTGRES_CONTAINER%" >nul

:done
echo [OK] Momentum zatrzymane. Dane PostgreSQL zachowane.
echo [OK] Docker Desktop nadal dziala.
exit /b 0
