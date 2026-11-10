# 작업 환경

기록일: 2026-11-10 · 기록 방법: 아래 명령의 실제 출력을 옮겨 적음

## 호스트

| 항목 | 값 | 확인 방법 |
| --- | --- | --- |
| OS | macOS 27.0.1 (build 26A434) | `sw_vers` |
| CPU 아키텍처 | arm64 (Apple Silicon) | `uname -m` |
| Shell | zsh | 세션 환경 |

## 분석 대상: Obsidian

| 항목 | 값 | 확인 방법 |
| --- | --- | --- |
| 설치 앱(셸) 버전 | 1.13.6 | `Obsidian.app/Contents/Info.plist`의 `CFBundleShortVersionString` / `CFBundleVersion` |
| **실제 실행 중인 앱 패키지** | **1.15.0** (`~/Library/Application Support/obsidian/obsidian-1.15.0.asar`) | 아래 "실행 버전 판별" 참고 |
| Electron | 43.3.0 | `Electron Framework.framework/.../Resources/Info.plist`의 `CFBundleVersion`, 바이너리 문자열 `Chrome/150.0.7871.212 Electron/43.3.0` |
| Chromium | 150.0.7871.212 | 위와 같은 문자열 |
| 코드 서명 | Identifier `md.obsidian`, TeamIdentifier `6JSW4SJWN9` | `codesign -dv` |
| Electron fuses | RunAsNode=off, NodeOptions=off, NodeCliInspect=off, EmbeddedAsarIntegrity=off, OnlyLoadAppFromAsar=off | REA `inspect_electron_fuses` (evidence `ev_b39b560c…`) |

### 분석용 사본 (원본은 수정하지 않음)

`cp -p`로 `analysis/asar/`에 복사한 뒤 SHA-256으로 원본과 같은지 확인했다.

| 사본 | 원본 | SHA-256 |
| --- | --- | --- |
| `analysis/asar/app.asar` | `/Applications/Obsidian.app/Contents/Resources/app.asar` (73,543 B) | `deb7d6c90a6c5eb61e3663ad1f70f88c8b9240fe2937e7d3fc1c3294cf24c238` |
| `analysis/asar/app.asar.unpacked/` | 같은 폴더의 `app.asar.unpacked/` (btime, get-fonts 네이티브 애드온) | — |
| `analysis/asar/obsidian-bundled-1.13.6.asar` | `/Applications/Obsidian.app/Contents/Resources/obsidian.asar` (25,785,345 B) | `d769003f81435abe53576172f3bb0695132880cc7b7970f2f0086f7d5ea968b5` |
| `analysis/asar/obsidian-1.15.0.asar` | `~/Library/Application Support/obsidian/obsidian-1.15.0.asar` (24,553,884 B) | `0e6383301078a798f0f3bdb42bdb606d904ada77eab8c8fc89da533573979248` |

`analysis/`는 `.gitignore`에 들어 있어 커밋되지 않는다. 확인 결과 `git status`가 깨끗했다.

### 실행 버전 판별 근거

1. **로더 코드 (seen).** `app.asar`의 `main.js`가 로더다. `package.json`에는 `"main": "main.js"`, `"version": "1.13.6"`가 적혀 있다. `main.js` 423–447행은 userData 폴더에서 `obsidian-*.asar`를 찾아 가장 높은 버전을 고른다. 그 버전이 셸 버전(`app.getVersion()`)보다 높거나 같으면 내장 `Resources/obsidian.asar` 대신 그 파일을 `loadApp()`으로 불러온다.
2. **로그 (seen).** `~/Library/Application Support/obsidian/obsidian.log` 3528행에 `2026-11-03 07:59:42 Loaded updated app …/obsidian-1.15.0.asar`가 있다. 1.15.0은 같은 로그 3479행에서 2026-11-02에 GitHub로부터 내려받았다.
3. **현재 프로세스 (seen).** 메인 프로세스 PID 715는 `Tue Nov 3 16:59:32 2026`(KST)에 시작했다. UTC로는 07:59:32라서 위 로그 시각과 맞는다. `lsof -p 715`로 보면 이 프로세스가 `Resources/app.asar`와 `Application Support/obsidian/obsidian-1.15.0.asar`를 열고 있다. `Resources/obsidian.asar`(1.13.6)는 열려 있지 않다.

→ **실제로 실행되는 앱 코드는 `obsidian-1.15.0.asar`이다.** `app.asar`(1.13.6)는 업데이트를 확인하고 asar를 고르는 로더 역할만 한다. 내장 `obsidian.asar`(1.13.6)는 업데이트를 불러오지 못했을 때 쓰는 예비본이다.

## 분석 도구

| 항목 | 값 | 확인 방법 |
| --- | --- | --- |
| REA | `rea-agents` 6.8.0 (MCP 서버 `rea` 6.8.0, MCP SDK 2.3.1). npx 캐시에서 실행 | REA `binary_session` → `server_identity`, `rea --version` |
| REA 사용 경로 | MCP(`analyze_javascript_application`, `inspect_electron_fuses`, `inspect_analysis_view`)와 CLI(`rea analyze-javascript-application … --evidence_output`) | — |
| REA 네이티브 엔진 | Ghidra/Hopper 미설정. 이번 작업은 JS 정적 분석이라 필요 없음 | `binary_session` |
| Node.js | v26.13.0 | `node --version` |
| npm | 11.20.0 | `npm --version` |
| Python | 시스템 `python3`. `analysis/` 사본에서 asar 헤더를 읽고 파일을 꺼내는 데만 사용 | — |

## 에이전트

| 항목 | 값 |
| --- | --- |
| Claude Code | 2.1.322 (`claude --version`) |
| 모델 | Claude Opus 5.5 (`claude-opus-5-5`) |
| 오케스트레이션 레이어 | oh-my-claudecode v4.9.1 (세션 시작 메시지 기준) |
