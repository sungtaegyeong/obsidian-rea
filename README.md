# REA Notes

IT 신기술 과제(PPT2: REA를 이용한 SW 개발)용 저장소.
소스코드가 공개되지 않은 마크다운 노트 앱을 REA로 분석하고, 같은 기능을 React + TypeScript로 처음부터 다시 만들었다.
원본 앱의 코드·문자열·아이콘·폰트 등 에셋은 쓰지 않았다 (클린룸 규칙은 `CLAUDE.md` 참고).

## 실행

```bash
npm install
npm run dev     # 웹으로 실행 → http://localhost:5173 (Chrome/Edge 권장)
npm run app     # 데스크톱 앱(Electron)으로 실행
```

시작 화면에서 **샘플 볼트 열기**(`sample-vault/`의 노트 9개) 또는 **폴더를 볼트로 열기**를 고른다.

## 구현한 기능

| 기능 | 내용 |
| --- | --- |
| 파일 탐색기 | 폴더 트리, 새 노트·폴더, 이름 바꾸기, 삭제, 드래그로 이동, 정렬 6종, 모두 접기 |
| 편집·읽기 모드 | CodeMirror 6 편집기, markdown-it 읽기 보기, 체크박스 토글 |
| Live Preview | 커서가 없는 줄의 `#`, `**`, `` ` ``, `[[ ]]` 기호 숨김 (설정에서 소스 모드로 전환) |
| 전체 검색 | 대소문자·정규식 토글, `tag:` `file:` `path:` 연산자, 결과 클릭 시 해당 줄로 이동 |
| 빠른 전환 | 퍼지 검색, 없는 이름이면 새 노트 만들기, Ctrl/⌘+Enter로 새 탭 |
| 커맨드 팔레트 | 명령 25개, 단축키 표시 |
| 탭·분할 | 여러 탭, 오른쪽으로 분할, 가운데 클릭으로 닫기 |
| 설정 | 테마, 강조 색, 글꼴 크기, 기본 보기, 줄 너비, 단축키 목록 (브라우저에 저장) |
| `[[링크]]`·백링크 | 링크 클릭 이동, 없는 노트 자동 생성, 연결된/연결되지 않은 언급, 이름 바꾸면 링크 자동 갱신 |
| 그래프 뷰 | d3-force, 드래그·확대·이동, 호버 강조, 태그·없는 노트·고립 노트 필터, 로컬 그래프 |
| 기타 | 개요, 태그 패널, 일일 노트, 단어·문자 수 상태 표시줄 |

## 단축키

| 동작 | 웹 | 데스크톱 |
| --- | --- | --- |
| 빠른 전환 | Ctrl/⌘ O | 같음 |
| 커맨드 팔레트 | Ctrl/⌘ P | 같음 |
| 편집·읽기 전환 | Ctrl/⌘ E | 같음 |
| 그래프 뷰 | Ctrl/⌘ G | 같음 |
| 전체 검색 | Ctrl/⌘ Shift F | 같음 |
| 오른쪽으로 분할 | Ctrl/⌘ \ | 같음 |
| 설정 | Ctrl/⌘ , | 같음 |
| 새 노트 / 새 탭 / 탭 닫기 | Ctrl/⌘ Alt N / T / W | Ctrl/⌘ N / T / W |

브라우저는 Ctrl/⌘+N·T·W를 페이지가 가로챌 수 없어서 웹에서는 Alt 조합을 쓴다.

## 구조

```
src/
  App.tsx                 레이아웃, 탭·분할 상태, 명령과 단축키
  vault.ts                저장소 추상화 (샘플 / 브라우저 폴더 / Electron)
  markdown.ts             링크·태그·제목 파싱, 읽기 모드 렌더링
  components/
    Editor.tsx            CodeMirror 6 편집기 + Live Preview
    ReadingView.tsx       읽기 모드
    FileExplorer.tsx      파일 탐색기
    SidePanels.tsx        검색, 태그, 백링크, 개요
    GraphView.tsx         그래프 뷰
    Modals.tsx            빠른 전환·커맨드 팔레트 공용 모달
    SettingsModal.tsx     설정
electron/                 데스크톱 셸 (main, preload)
docs/                     분석 기록, 기능 비교, 실패 기록
```
