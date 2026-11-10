# CodeMirror 6

웹 기반 코드·텍스트 편집기 라이브러리.

## 핵심 개념
1. **EditorState**: 문서와 선택 영역을 담는 불변 상태
2. **EditorView**: 상태를 화면에 그리는 뷰
3. **Extension**: 기능을 조합하는 단위

```ts
const view = new EditorView({ doc: "# Hello", parent: document.body });
```

관련: [[REA Notes 개발]]

#공부 #프론트엔드
