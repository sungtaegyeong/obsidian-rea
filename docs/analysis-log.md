# 분석 기록

## [실행 버전 판별과 패키지 구조]  (2026-11-10, REA 6.8.0)
- 질문: 실제로 실행되는 앱 코드는 어느 .asar이고, 패키지는 어떻게 구성되어 있는가?
- SEEN:
  - `.asar`는 3개다. `Resources/app.asar`(로더, package.json 버전 1.13.6), `Resources/obsidian.asar`(내장 앱 1.13.6), `~/Library/Application Support/obsidian/obsidian-1.15.0.asar`(업데이트된 앱).
  - 로더 `app.asar/main.js` 423–447행: userData에서 `obsidian-*.asar` 중 가장 높은 버전을 고르고, 셸 버전 이상이면 그 파일을 `loadApp()`한다.
  - `obsidian.log` 3528행: `Loaded updated app …/obsidian-1.15.0.asar`(2026-11-03 07:59:42).
  - PID 715 시작 시각은 2026-11-03 16:59:32 KST(=07:59:32 UTC). `lsof`로 보면 `app.asar`와 `obsidian-1.15.0.asar`만 열려 있다.
  - REA `inspect_electron_fuses`(ev_b39b560c…): RunAsNode, NodeOptions, NodeCliInspect가 꺼져 있고 OnlyLoadAppFromAsar도 꺼져 있다.
  - REA `analyze_javascript_application`(app.asar, parent ev_8b559641…): `@electron/remote`가 있고, 네이티브 애드온 바인딩 2개(btime, get-fonts)는 해석되었다. unpacked `binding.node` 2개는 asar에 선언된 무결성 값과 달랐다. 패키징 뒤 코드 서명을 했기 때문으로 보이며, `record-and-continue`로 분석했다.
  - REA `analyze_javascript_application`(1.15.0, `main.js` 등 5개 파일만 선택, parent ev_0a93ad2a…): 메인 IPC 핸들러는 리터럴 채널 48개, 동적 채널 0개다.
  - REA CLI로 1.15.0 전체를 분석하자 `lib/codemirror/modes.min.js`에서 소스별 제한 시간 300초를 넘겨 실패했다. 1st-party 11개만 골라 제한 시간을 1,500초로 늘려 다시 돌리자 성공했다(parent ev_58211520…). JS 7개 파싱, 실패 0, worker 생성 노드 5개, `app.js` 모듈 경계 복원 0.
- INFERRED: 내장 `obsidian.asar`는 업데이트를 불러오지 못했을 때 쓰는 예비본이다(로더의 오류 대화상자 문자열 근거).
- UNKNOWN: REA가 `BrowserWindow` 생성을 0건으로 집계했다. `new r.BrowserWindow` 별칭을 따라가지 못한 것이다. 창의 webPreferences는 아직 확인하지 않았다.
- 구현 방침: 분석 대상은 1.15.0으로 고정한다. 재구현에서는 로더·자동 업데이트 구조를 만들지 않는다.
