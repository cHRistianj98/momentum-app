@echo off
setlocal EnableExtensions

REM ================================================================
REM MOMENTUM - START  (postaw ten plik w katalogu projektu)
REM ================================================================
REM ZMIENIAJ PORTY I USTAWIENIA TUTAJ:
set "FRONTEND_PORT=5180"
set "BACKEND_PORT=8082"
set "POSTGRES_PORT=5435"
set "DB_NAME=momentum"
set "DB_USER=momentum"
set "DB_PASSWORD=momentum_dev_5435"
set "POSTGRES_CONTAINER=momentum-postgres-5435"
REM ================================================================

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "PATH=%PATH%;%ProgramFiles%\Docker\Docker\resources\bin"

cls
echo =====================================================
echo                    MOMENTUM START
echo =====================================================
echo Folder: %PROJECT_DIR%
echo Frontend: http://localhost:%FRONTEND_PORT%
echo Backend:  http://localhost:%BACKEND_PORT%
echo Postgres: localhost:%POSTGRES_PORT%
echo.

REM --- 1. Docker Desktop ---
where docker.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Desktop nie jest zainstalowany lub docker.exe nie jest w PATH.
    goto :failed
)
docker info >nul 2>&1
if errorlevel 1 (
    echo [DOCKER] Uruchamiam Docker Desktop...
    if not exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
        echo [ERROR] Nie znaleziono Docker Desktop.exe.
        goto :failed
    )
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    for /l %%I in (1,1,60) do (
        docker info >nul 2>&1
        if not errorlevel 1 goto :docker_ready
        timeout /t 2 /nobreak >nul
    )
    echo [ERROR] Docker nie wystartowal.
    goto :failed
)
:docker_ready
echo [OK] Docker dziala.

REM --- 2. PostgreSQL (sam kontener, bez dodatkowych YAML) ---
set "OWN_POSTGRES=0"
docker container inspect "%POSTGRES_CONTAINER%" >nul 2>&1
if not errorlevel 1 (
    set "OWN_POSTGRES=1"
    docker inspect -f "{{.State.Running}}" "%POSTGRES_CONTAINER%" | findstr /i /c:"true" >nul
    if errorlevel 1 (
        echo [POSTGRES] Uruchamiam istniejacy kontener...
        docker start "%POSTGRES_CONTAINER%" >nul
        if errorlevel 1 goto :failed
    ) else (
        echo [OK] Kontener PostgreSQL juz dziala.
    )
) else (
    call :port_in_use %POSTGRES_PORT%
    if not errorlevel 1 (
        echo [INFO] Port %POSTGRES_PORT% jest zajety - nie tworze nowej bazy.
        echo [INFO] Sprawdz, czy dziala na nim wlasciwy PostgreSQL.
    ) else (
        echo [POSTGRES] Tworze kontener %POSTGRES_CONTAINER% na porcie %POSTGRES_PORT%...
        docker run -d --name "%POSTGRES_CONTAINER%" -p %POSTGRES_PORT%:5432 -e POSTGRES_DB=%DB_NAME% -e POSTGRES_USER=%DB_USER% -e POSTGRES_PASSWORD=%DB_PASSWORD% -v momentum-postgres-data:/var/lib/postgresql/data postgres:16-alpine >nul
        if errorlevel 1 goto :failed
        set "OWN_POSTGRES=1"
    )
)

REM Poczekaj na gotowosc wlasnego kontenera (zwykle kilka sekund).
if "%OWN_POSTGRES%"=="1" (
    echo [POSTGRES] Czekam na gotowosc bazy...
    for /l %%I in (1,1,45) do (
        docker exec "%POSTGRES_CONTAINER%" pg_isready -U %DB_USER% -d %DB_NAME% >nul 2>&1
        if not errorlevel 1 goto :postgres_ready
        timeout /t 2 /nobreak >nul
    )
    echo [ERROR] PostgreSQL nie jest gotowy.
    goto :failed
)
:postgres_ready

REM --- 3. Frontend React - WLASNE OKNO terminala z logami ---
set "FRONTEND_DIR=%PROJECT_DIR%"
if not exist "%FRONTEND_DIR%\package.json" if exist "%PROJECT_DIR%\frontend\package.json" set "FRONTEND_DIR=%PROJECT_DIR%\frontend"
if not exist "%FRONTEND_DIR%\package.json" if exist "%PROJECT_DIR%\momentum-app\package.json" set "FRONTEND_DIR=%PROJECT_DIR%\momentum-app"
if not exist "%FRONTEND_DIR%\package.json" (
    echo [ERROR] Nie ma package.json w projekcie ani frontend\.
    goto :failed
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Nie znaleziono Node.js / npm.
    goto :failed
)
if not exist "%FRONTEND_DIR%\node_modules" (
    echo [NPM] Instaluje zaleznosci frontendu - jednorazowo...
    pushd "%FRONTEND_DIR%"
    call npm.cmd install
    if errorlevel 1 (
        popd
        goto :failed
    )
    popd
)
call :port_in_use %FRONTEND_PORT%
if not errorlevel 1 (
    echo [INFO] Port %FRONTEND_PORT% jest zajety - nie odpalam drugiego frontendu.
) else (
    echo [FRONTEND] Otwieram NOWE, OSOBNE okno CMD na porcie %FRONTEND_PORT%...
    start "MOMENTUM_FRONTEND_WINDOW" /D "%FRONTEND_DIR%" cmd.exe /k "title MOMENTUM_FRONTEND_WINDOW && echo ==== MOMENTUM FRONTEND :%FRONTEND_PORT% ==== && npm.cmd run dev -- --host 127.0.0.1 --port %FRONTEND_PORT% --strictPort"
)

REM --- 4. Backend Spring Boot - DRUGIE WLASNE OKNO (gdy backend istnieje) ---
set "BACKEND_DIR="
if exist "%PROJECT_DIR%\backend\pom.xml" set "BACKEND_DIR=%PROJECT_DIR%\backend"
if exist "%PROJECT_DIR%\backend\build.gradle" set "BACKEND_DIR=%PROJECT_DIR%\backend"
if exist "%PROJECT_DIR%\backend\build.gradle.kts" set "BACKEND_DIR=%PROJECT_DIR%\backend"
if not defined BACKEND_DIR if exist "%PROJECT_DIR%\server\pom.xml" set "BACKEND_DIR=%PROJECT_DIR%\server"
if not defined BACKEND_DIR if exist "%PROJECT_DIR%\server\build.gradle" set "BACKEND_DIR=%PROJECT_DIR%\server"
if not defined BACKEND_DIR if exist "%PROJECT_DIR%\pom.xml" set "BACKEND_DIR=%PROJECT_DIR%"

if not defined BACKEND_DIR (
    echo [INFO] Nie znaleziono backendu Spring Boot - Momentum v0.1 ma tylko frontend.
    goto :done
)

set "BACKEND_RUN="
if exist "%BACKEND_DIR%\mvnw.cmd" set "BACKEND_RUN=call mvnw.cmd spring-boot:run"
if not defined BACKEND_RUN if exist "%BACKEND_DIR%\gradlew.bat" set "BACKEND_RUN=call gradlew.bat bootRun"
if not defined BACKEND_RUN if exist "%BACKEND_DIR%\pom.xml" (
    where mvn.cmd >nul 2>&1
    if not errorlevel 1 set "BACKEND_RUN=call mvn.cmd spring-boot:run"
)
if not defined BACKEND_RUN if exist "%BACKEND_DIR%\build.gradle" (
    where gradle.bat >nul 2>&1
    if not errorlevel 1 set "BACKEND_RUN=call gradle.bat bootRun"
)
if not defined BACKEND_RUN (
    echo [WARN] Jest backend, ale nie znaleziono Maven/Gradle ani wrappera.
    goto :done
)

REM Spring Boot pobierze te zmienne automatycznie.
set "SERVER_PORT=%BACKEND_PORT%"
set "SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:%POSTGRES_PORT%/%DB_NAME%"
set "SPRING_DATASOURCE_USERNAME=%DB_USER%"
set "SPRING_DATASOURCE_PASSWORD=%DB_PASSWORD%"

call :port_in_use %BACKEND_PORT%
if not errorlevel 1 (
    echo [INFO] Port %BACKEND_PORT% jest zajety - nie odpalam drugiego backendu.
) else (
    echo [BACKEND] Otwieram DRUGIE oddzielne okno terminala na porcie %BACKEND_PORT%...
    start "MOMENTUM_BACKEND_WINDOW" /D "%BACKEND_DIR%" cmd.exe /k "title MOMENTUM_BACKEND_WINDOW && echo ==== MOMENTUM BACKEND :%BACKEND_PORT% ==== && %BACKEND_RUN%"
)

:done
echo.
echo [OK] START zakonczony. Frontend i backend maja osobne okna terminala.
echo      Do zamkniecia uzyj stop.bat.
exit /b 0

:port_in_use
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort %~1 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
exit /b %errorlevel%

:failed
echo.
echo [ERROR] Nie udalo sie uruchomic wszystkich skladnikow.
pause
exit /b 1
