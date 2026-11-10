# 기능 목록과 구현 상태 (초안)

- 분석 대상: Obsidian 앱 패키지 **1.15.0** (`analysis/asar/obsidian-1.15.0.asar`, SHA-256 `0e638330…9248`). 실행 버전을 판별한 근거는 [environment.md](environment.md)에 있다.
- 분석 방법: REA 6.8.0 정적 분석과, `analysis/` 사본에서 꺼낸 파일의 식별자·문자열 검색. **앱을 실행해서 화면으로 확인한 것은 아직 없다.**
- 작성일: 2026-11-10 · 상태: 초안. 구현은 아직 시작하지 않았다.

## 판정 기준

| 표기 | 뜻 |
| --- | --- |
| **seen** | 배포된 코드에서 직접 확인함: view type, command id, 등록 목록, 파일 등의 식별자. 다만 **"코드에 있다"는 뜻일 뿐, 실행해서 동작을 본 것은 아니다.** |
| **inferred** | 근거는 강하지만 동작은 확인하지 못한 추정. 근거를 함께 적는다. |
| **unknown** | 찾지 못했거나 판단할 수 없음. 검색 결과가 없다고 기능이 없다는 뜻은 아니다. |

근거 표기 `app.js`, `main.js` 등은 `obsidian-1.15.0.asar` 안의 경로다. `loader-main.js`는 `app.asar/main.js`를 가리킨다.

## 1. 프로세스와 진입점 구조

| 구성 | 판정 | 근거 |
| --- | --- | --- |
| 로더(app.asar) → 앱 패키지(obsidian-x.y.z.asar)의 2단 구조 | seen | `loader-main.js` 423–471행: userData의 `obsidian-*.asar` 중 가장 높은 버전을 `loadApp()`으로 불러오고, 실패하면 내장 `obsidian.asar`를 쓴다 |
| 메인 프로세스 = `main.js` (212 KB) | seen | 앱 패키지 루트의 `main.js`. REA 집계로 메인 IPC 핸들러는 리터럴 채널 48개, 동적 채널 0개이고 grep으로 센 고유 채널 수도 48개로 같다(`vault-open`, `vault-list`, `starter`, `help`, `print-to-pdf`, `trash`, `context-menu`, `set-menu` 등). 창 생성은 `new r.BrowserWindow` 2곳인데, REA는 이 별칭을 따라가지 못해 `browser_windows: 0`으로 집계했다 |
| 메인 창 렌더러 = `index.html` → `app.js` (3.3 MB, 번들) | seen | `index.html`이 CodeMirror 부속 파일, moment, i18next, turndown, `enhance.js`, `i18n.js`, `app.js`를 순서대로 불러온다 |
| 메타데이터 캐시 워커 | seen | `app.js`: `new Worker("worker.js",{name:"Metadata Cache Worker"})` |
| 그래프 레이아웃 워커 | seen | `app.js`: `new Worker("/sim.js",{name:"Graph Worker"})` |
| 렌더러의 Node/Electron 접근 방식 | inferred | `app.asar`에 `@electron/remote` 2.1.3이 들어 있다. REA 결과에서 preload/contextBridge는 0건(app.asar 기준). 렌더러가 remote 모듈로 메인 API를 쓰는 구조로 보이나, 확인하지 않았다 |

## 2. 주요 화면

| 화면 | 판정 | 근거 | 비고 |
| --- | --- | --- | --- |
| 볼트 선택/관리 화면 (starter) | seen | `starter.html`, `starter.js`. IPC `starter`, `vault-list`, `vault-open`, `vault-remove`, `vault-move`, `get-default-vault-path` | 화면 구성은 실행해서 확인해야 함 |
| 메인 작업 공간 (리본 + 좌·우 사이드바 + 탭 그룹 + 상태 표시줄) | seen (구성 요소) / inferred (배치) | 명령 `app:toggle-ribbon`, `app:toggle-left-sidebar`, `app:toggle-right-sidebar`, `workspace:split-vertical/horizontal`, `workspace:new-tab`. 상태 표시줄을 쓰는 플러그인(`word-count`, `editor-status`) | 실제 배치와 기본 레이아웃은 런타임으로 확인 필요 |
| 설정 모달 | seen | `app.js`의 설정 탭 id 9개: `about`(General), `editor`, `file`, `appearance`, `hotkeys`, `keychain`, `interface`, `plugins`(Core plugins), `community-plugins` | `keychain`과 `community-plugins`는 범위 밖(아래 6절) |
| 도움말 창 | seen (진입점) / unknown (내용) | `help.html`, `help.js`, IPC `help`, 명령 `app:open-help` | |
| 샌드박스 볼트 | seen | 패키지 안에 `sandbox/` 마크다운 31개, 명령 `app:open-sandbox-vault`, IPC `get-sandbox-vault-path`, `sandbox` | 예제 노트 내용은 클린룸 규칙상 가져오지 않는다 |
| Quick Look 미리보기 | inferred | `quicklook/index.html`, `quicklook.js`, `quicklook.css`가 있다. macOS Quick Look 확장용으로 보이나 확인하지 않았다 | 재구현 대상 아님 |
| 새 창(팝아웃) | seen | `workspace:new-window`, `workspace:move-to-new-window`, `workspace:open-in-new-window`, `editor:open-link-in-new-window` | |

## 3. 기능 목록: CLAUDE.md 구현 단계 기준

| 단계 | 기능 | 판정 | 근거 (식별자) | 아직 모르는 것 | 구현 상태 |
| --- | --- | --- | --- | --- | --- |
| 기본 | 파일·폴더 탐색기 | seen | view `file-explorer`, core plugin `file-explorer`(i18n 이름 "Files"). 명령 8개(`file-explorer:*`). 정렬 6종(이름 A–Z/Z–A, 수정·생성 시각 오름·내림차순). 새 노트/새 폴더/이름 바꾸기/삭제/복제/이동. 파일명 금지 문자 검사 메시지 | 드래그 앤 드롭 규칙, 삭제 동작(`file` 설정 탭의 `deleteOption`에서 `system` 휴지통 등) | 미착수 |
| 기본 | 마크다운 편집 모드 | seen | view `markdown`, CSS 클래스 `markdown-source-view`, `cm-content`. `editor:` 명령 69개(굵게·기울임·목록·체크리스트·표·콜아웃·코드블록·각주·접기 등) | 편집기 엔진 버전 | 미착수 |
| 기본 | 읽기 모드 | seen | CSS 클래스 `markdown-reading-view`, 명령 `editor:toggle-source`(모드 전환) | 렌더러 파이프라인, 마크다운 확장 문법(콜아웃·각주·주석·하이라이트)의 정확한 처리 규칙 | 미착수 |
| 기본 | 전체 검색 | seen | view `search`, core plugin `global-search`, 명령 `global-search:open`. i18n 옵션: 대소문자 구분, 정규식, 속성 일치, 크게/작게/참/거짓/비었음 조건, "Explain search terms" | 검색 연산자 문법 전체, 인덱스 방식 | 미착수 |
| 기본 | 빠른 전환 (Quick switcher) | seen | core plugin `switcher`, 명령 `switcher:open`, `app:show-tab-switcher` | 정렬과 퍼지 매칭 알고리즘 | 미착수 |
| 기본 | 커맨드 팔레트 | seen | core plugin `command-palette`, 명령 `command-palette:open`. 등록 command id 197개(`app.js` 정적 집계) | 최근 사용 명령 정렬 규칙 | 미착수 |
| 기본 | 탭·분할 화면 | seen | `workspace:` 명령 23개: 새 탭, 다음/이전 탭, 닫기, 다른 탭 닫기, 수직/수평 분할, 고정(pin), 쌓인 탭(stacked), 닫은 탭 되살리기, 새 창으로 이동 | 레이아웃 직렬화 형식(`workspace.json` 등은 inferred) | 미착수 |
| 기본 | 설정 | seen | 설정 탭 9개(2절). `editor` 탭의 Vim 관련 `passedVimTest` 필드 | 설정 항목 전체와 기본값 | 미착수 |
| 심화 | `[[링크]]` | seen | 명령 `editor:insert-wikilink`, `editor:follow-link`, `editor:open-link-in-new-leaf/split/window`. 파일 탐색기 메시지 "Links will not work with file names containing…" | 링크 해석 규칙(경로/별칭/헤딩/블록 참조) | 미착수 |
| 심화 | 백링크 | seen | view `backlink`, core plugin `backlink`(i18n: "별도 view 또는 노트 하단에 표시"), 명령 `backlink:*` 3개 | 링크 인덱스 갱신 시점(`worker.js` 관여는 inferred) | 미착수 |
| 심화 | 나가는 링크 / 링크 안 된 언급 | seen | view `outgoing-link`, core plugin `outgoing-link`(i18n: "unlinked mentions" 감지) | 언급 매칭 규칙 | 미착수 |
| 심화 | 실시간 미리보기 (Live Preview) | seen (식별자) / inferred (동작) | `app.js`의 `livePreview` 14회, CSS `is-live-preview` 1회 | 커서 위치에 따라 마크업을 숨기고 보이는 규칙. 런타임 관찰 필요 | 미착수 |
| 도전 | 그래프 뷰 (전체·로컬) | seen | view `graph`, `localgraph`, core plugin `graph`, 명령 `graph:*` 3개. `sim.js` 워커("Graph Worker"), `lib/pixi.min.js` 7.2.4 로드 | 힘 시뮬레이션 파라미터, 필터·그룹 설정 | 미착수 |
| 도전 | 캔버스 | seen | view `canvas`, core plugin `canvas`, 확장자 `.canvas` 등록(`registerExtensions([rl],fC)`, `rl="canvas"`), 명령 `canvas:*` 4개 | `.canvas` 파일 스키마(JSON으로 inferred), 노드·엣지 종류 | 미착수 |

## 4. 그 밖의 코어 플러그인 (재구현 범위 결정 필요)

`app.js` 안의 코어 플러그인 id 목록(`XMe`, 30개)을 기준으로 했다. 이름과 설명은 `i18n.js`의 영어 문자열에서 가져왔다.

| id | 이름 (i18n) | 판정 | 근거 | 로컬 전용 여부 |
| --- | --- | --- | --- | --- |
| `tag-pane` | Tags view | seen | view `tag`, 명령 `tag-pane:open` | 로컬 |
| `properties` | Properties view | seen | view `all-properties`, `file-properties`, 명령 `properties:open(-local)`, `app:migrate-frontmatter` | 로컬 |
| `footnotes` | Footnotes view | seen | view `footnotes`, 명령 `footnotes:open` | 로컬 |
| `page-preview` | Page preview | seen | i18n: 내부 링크에 마우스를 올리면 미리보기 | 로컬 |
| `outline` | Outline | seen | view `outline`, 명령 `outline:open(-for-current)` | 로컬 |
| `bookmarks` | Bookmarks | seen | view `bookmarks`, 명령 `bookmarks:*` 7개 | 로컬 |
| `daily-notes` | Daily notes | seen | 명령 `daily-notes:goto-next/prev` | 로컬 |
| `templates` | Templates | seen | i18n: 템플릿 폴더의 내용을 삽입 | 로컬 |
| `note-composer` | Note composer | seen | 명령 `merge-file`, `split-file`, `extract-heading` | 로컬 |
| `slash-command` | Slash commands | seen | i18n 설명 | 로컬 |
| `editor-status` | Show editing mode in status bar | seen | i18n 설명 | 로컬 |
| `zk-prefixer` | Unique note creator | seen | i18n 설명 | 로컬 |
| `random-note` | Random note | seen | i18n 설명 | 로컬 |
| `word-count` | Word count | seen | i18n: 상태 표시줄에 단어 수 표시 | 로컬 |
| `slides` | Slides | seen | 명령 `slides:start`, `lib/reveal/` | 로컬 |
| `audio-recorder` | Audio recorder | seen | 명령 `audio-recorder:start/stop` | 로컬 (마이크 권한) |
| `workspaces` | Workspaces | seen | 명령 `workspaces:*` 4개 | 로컬 |
| `file-recovery` | File recovery | seen | 명령 `file-recovery:open`. i18n: 마크다운 파일만 스냅샷 저장 | 로컬 (저장 위치 unknown) |
| `bases` | Bases | seen | view `bases`, 확장자 `.base` 등록(`Ma="base"`), 명령 `bases:*` 6개 | 로컬 |
| `webviewer` | Web viewer | seen | view `webviewer`, 명령 9개, 메인 IPC `adblock-lists`, `create-browser-session` | 네트워크 사용. 범위 검토 필요 |
| `publish` | Publish | seen | 명령 `publish:*` 3개 | **제외** (서버 의존) |
| `sync` | Sync | seen | view `sync`, 명령 `sync:*` 4개 | **제외** (서버 의존) |

`XMe` 말고도 `ZDe`라는 26개 목록이 있다. 여기에는 `starred`, `markdown-importer`처럼 `XMe`에 없는 id가 들어 있다. 예전 버전과의 호환이나 기본 활성화 목록으로 **inferred**할 수 있지만, 용도는 **unknown**이다.

## 5. 공통 기반 기능

| 기능 | 판정 | 근거 |
| --- | --- | --- |
| 첨부 파일 뷰어: 이미지·오디오·비디오·PDF | seen | 확장자 배열 `["bmp","png","jpg","jpeg","gif","svg","webp","avif"]`, `["mp3","wav","m4a","3gp","flac","ogg","oga","opus"]`, `["mp4","webm","ogv","mov","mkv"]`. view `image`, `audio`, `video`, `pdf`, `lib/pdfjs/` |
| PDF로 내보내기 | seen | 명령 `workspace:export-pdf`, 메인 IPC `print-to-pdf` |
| 수식 렌더링 | seen | `lib/mathjax/obsidian-mathjax.js`, 명령 `editor:toggle-inline-math`, `editor:insert-mathblock` |
| 코드 하이라이트 | inferred | `lib/prism.min.js`, `lib/codemirror/modes.min.js`가 들어 있다. 어느 모드에서 어떤 것을 쓰는지는 unknown |
| Vim 키 바인딩 | seen | `lib/codemirror/vim.js`, 설정 탭 `editor`의 `passedVimTest` |
| 단축키 사용자 지정 | seen | 설정 탭 `hotkeys` (`commandBeingCustomized`, `hotkeyToCommands`) |
| 테마·외관·CSS | seen | 설정 탭 `appearance`, 이벤트 `css-change`, 명령 `theme:*` 2개. 기본 body 클래스 `theme-dark` |
| 다국어 UI | seen | `i18n/` 번역 파일 50개 + `mapping.txt`. 영어 원문은 `i18n.js`에 들어 있다. 메인 IPC `set-language` |
| 휴지통 / 삭제 | seen | 메인 IPC `trash`, 명령 `workspace:show-trash`, `app:delete-file` |
| 웹 페이지 → 마크다운 변환 | inferred | `lib/turndown.js`, `lib/defuddle.full.js`, `lib/readability.js`. 웹 뷰어 저장이나 붙여넣기에 쓰이는 것으로 보임 |
| 앞으로/뒤로 탐색 | seen | 명령 `app:go-back`, `app:go-forward` |
| 글꼴 크기 조절 | seen | 명령 `app:increase-font-size`, `app:decrease-font-size`. 시스템 글꼴 목록은 네이티브 애드온 `get-fonts`(app.asar.unpacked) |

## 6. 범위 밖 (CLAUDE.md 1절, 3-5항)

| 기능 | 근거 | 사유 |
| --- | --- | --- |
| Sync, Publish | core plugin `sync`, `publish` | 서버 의존 |
| 커뮤니티 플러그인 | 설정 탭 `community-plugins`, IPC `plugin-script-root` | 생태계 의존 |
| Keychain (비밀 저장소) | 설정 탭 `keychain`, `app.secretStorage` | 암호화·자격 증명 관련이라 분석하지 않는다 |
| 자동 업데이트, insider 빌드 | `loader-main.js`의 업데이트 루틴, IPC `check-update`, `insider-build`, `copy-asar` | 서명 검증·배포 관련 |
| 계정, 라이선스, 결제 | — | 규칙상 분석하지 않는다. `lib/scrypt.js`의 용도도 확인하지 않는다 |
| CLI 등록 | IPC `register-cli`, `cli` | 데스크톱 통합. 필요할 때 다시 검토 |

## 7. 아직 모르는 것 (다음 분석 후보)

1. 편집기 엔진: `cm-content`, `ChangeSet`, `lezer` 식별자를 보면 CodeMirror 6 번들일 가능성이 높다(inferred). `lib/codemirror/`의 CM5 계열 파일이 어떤 역할을 하는지는 unknown이다.
2. 볼트 설정 저장 형식: `.obsidian/` 폴더 구조와 `writeConfigJson` 대상 파일 목록은 아직 추적하지 않았다.
3. `[[링크]]` 해석 규칙, 백링크 인덱스를 갱신하는 시점, `worker.js`의 메시지 프로토콜.
4. Live Preview에서 마크업을 숨기는 규칙. 정적 분석만으로는 한계가 있어 런타임에서 관찰해야 한다.
5. 런타임 확인: 이번 문서의 seen은 모두 정적 근거다. 다음 단계에서 테스트용 볼트를 만들어 화면별로 실제 동작을 확인해야 한다(원본 앱은 수정하지 않고 실행만 한다).

## 8. REA 분석 실행 기록

| 실행 | 대상 / 범위 | 결과 | Evidence |
| --- | --- | --- | --- |
| `inspect_electron_fuses` (MCP) | `/Applications/Obsidian.app`. 바이트를 읽기만 함 | 9개 fuse 완전 판독 (environment.md) | `ev_b39b560c…` |
| `analyze_javascript_application` (MCP) | `app.asar` 사본 전체 | JS 15개 파싱, 실패 0. IPC 17건(리터럴 4, 동적 13). 네이티브 애드온 2개 해석. unpacked `.node` 무결성 불일치 2건(코드 서명으로 추정) | parent `ev_8b559641…` |
| `analyze_javascript_application` (MCP) | 1.15.0 사본. `package.json`, `main.js`, `index.html`, `starter.html`, `help.html`만 선택 | 메인 IPC 핸들러 리터럴 48개, 동적 0개 | parent `ev_0a93ad2a…` → `analysis/rea/mcp-session-2026-11-10.evidence.json` |
| `rea analyze-javascript-application` (CLI) | 1.15.0 사본 전체 | **실패.** `lib/codemirror/modes.min.js`(11/38번째)에서 소스별 제한 시간 300초를 넘김. 부분 Evidence에는 서드파티 lib 8개만 파싱되고 24개는 건너뜀 | `analysis/rea/obsidian-1.15.0.full-run-timeout.json` (partial `ev_74bdbb7b…`) |
| `rea analyze-javascript-application` (CLI) | 1.15.0 사본의 1st-party 11개(`app.js`, `main.js`, `worker.js`, `sim.js`, `starter.js`, `help.js`, `enhance.js`, HTML·package.json). 제한 시간 1,500초, heap 4 GB | 성공(75초). JS 7개 파싱, 실패 0, AST 노드 1,180,146개, finding 548개. IPC 핸들러 48개, worker 생성 노드 5개. 그래프 coverage는 partial이고 semantic unknown이 53,738개 남음 | parent `ev_58211520…` → `analysis/rea/obsidian-1.15.0.firstparty.evidence.json` |

**REA 결과를 읽을 때 주의할 점**
- 모두 정적 분석이다. 실행 여부, 런타임 등록, 도달 가능성은 증명되지 않았다.
- `app.js`는 압축된 단일 번들이라 REA가 모듈 경계를 복원하지 못했다(`modules: 0`). 위 표의 view/command/plugin 식별자는 REA가 아니라 사본에서 꺼낸 `app.js`·`i18n.js`의 문자열을 검색해서 얻은 것이다. 근거 수준은 "식별자가 존재함"까지다.
- 렌더러 측 IPC 송신은 REA 집계로 0건이다. 이는 `@electron/remote`나 별칭을 거친 호출을 추적하지 못한 결과로 보이며, IPC 송신이 없다는 뜻이 아니다(unknown).
- 서드파티 lib(`lib/**`) 27개는 분석 범위에서 뺐다. 그 관계는 unknown이다.

## 부록: i18n에만 있는 플러그인 이름

`i18n.js`에는 `XMe` 목록에 없는 `customCss`(Custom CSS), `translucency`(Translucent window), `openWithDefaultApp`(Open in default app) 항목이 있다. 이것이 현재 코어 플러그인인지, 설정 항목으로 흡수되었는지, 남아 있는 레거시 문자열인지는 **unknown**이다.
