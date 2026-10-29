# imgman 수정 결과 (2026-10-29)

감사 보고서 `document/2026-10-29-app-audit.md`의 확정 결함 6건과, 독립 리뷰 `.ego-wol/fixes-20261029/reviewer-notes.md`의 잔여 결함 6건(+ 검증 픽스처 의존)을 Cursor Agent CLI로 고쳤다. 선택 기능(자동 저장, 광범위한 재설계)은 넣지 않았다. 기존 미커밋 변경인 `CanvasArea.tsx`(클릭만으로 선이 생기지 않음)와 `Toolbar.tsx`(도형 버튼 통합)는 유지했다. 커밋·배포·푸시는 하지 않았다. 사용자가 Cursor 창 조작 중지를 지시한 이후에는 해당 창을 조작하지 않았다.

## 1차 적용 (감사 6건)

### 1. Undo/Redo 히스토리

`isHistoryActionRef`를 제거했다. `src/hooks/useDocumentHistory.ts`의 `commitHistory`는 항상 새 스냅샷을 쌓고, Undo 이후 새 편집은 redo 분기를 잘라 낸다.

- 레이어 추가/삭제/복제/불러오기는 `activeLayerId`를 스냅샷에 명시적으로 넣는다.
- Undo/Redo 시 없어진 선택·크롭 대상을 정리한다.
- 문서 상태는 기존처럼 App이 들고, 히스토리만 작은 훅으로 분리했다.

### 2. 프로젝트 JSON 검증 + ErrorBoundary

`src/utils/projectSchema.ts`가 상태 반영 전에 검사한다. 실패 시 현재 문서는 그대로 두고 토스트로 이유를 보여 준다. `src/components/ErrorBoundary.tsx`는 렌더 오류 시 문서를 지우지 않고, 메모리 세션 캐시(`documentSession`)로 복구를 시도한다.

### 3. 잠금 무결성

`src/utils/lockGuards.ts`의 `canEditElement` / `canApplyElementMutation`을 삭제, 속성 변경, 채우기, 지우개, 미세 이동, 정렬/순서, 오리기, 그룹, 캔버스 비우기, 레이어 삭제에 적용했다. 검사 기준은 활성 레이어가 아니라 **객체의 실제 `layerId`**다.

선택은 허용하고 수정만 막는다. 객체 `locked` 토글은 레이어가 잠기지 않은 경우에만 허용한다. 캔버스 비우기는 잠긴 객체와 잠긴 레이어의 객체를 남긴다.

### 4. 모달 입력 격리

`src/components/ModalDialog.tsx`: `role="dialog"`, `aria-modal`, 포커스 진입/트랩/복원, Esc는 모달만 닫는다. Export / NewCanvas / Shortcuts / ClipboardGuide에 적용했다.

### 5. 복제/그룹 ID

`src/utils/cloneElements.ts`가 한 묶음 안에서 그룹 관계를 유지하고, 원본 및 다른 묶음과는 분리된 새 `groupId`를 준다. 브러시 절대 좌표도 함께 이동한다.

### 6. 화면에 맞추기 (1차)

고정 `setZoom(0.85)`를 제거했다. `computeViewportFit`이 실제 작업 영역, 눈금자, 여백으로 배율과 팬을 계산한다.

## 독립 리뷰 후속 (코드 수정)

문서만 고친 것이 아니다. 리뷰가 재현한 실패(viewport-edge-review, schema-edge-review, 브라우저 Fit→100%가 25%로 되돌아감, 잠긴 자식이 레이어 삭제로 제거됨, 잘못된 polyline points가 ErrorBoundary로 터짐, committed out-parameter)를 아래처럼 고쳤다.

### R1. Fit 줌이 수동 25% 바닥에 막히지 않음

`FIT_MIN_ZOOM = 0.01`을 맞춤 전용 하한으로 둔다. 수동 ±/휠은 기본적으로 0.25–4를 유지하되, `clampManualZoom`은 **현재 줌이 이미 25% 아래(맞춤 결과)**이면 25%로 끌어올리지 않는다. 240×700 스테이지에 1920/4000 캔버스를 넣으면 전체가 뷰포트 안에 들어가고 `pan.x/y >= 24`이다.

### R2. 중첩 points / 선택 필드 검증

polyline/arc는 좌표 2개 이상이 필요하고, 모든 타입에서 `points`가 있으면 `{x,y}` 유한 좌표인지 검사한다. 있는 경우 `shadow`/`gradient`/`beginArrow`/`endArrow`, `groupId`/`locked`/`visible`/`flipH`/`flipV`도 검사한다. `[null,null]`, `{}`, 잘못된 `x`는 파일을 거절하고 현재 문서를 유지한다.

### R3. 모달 포커스 트랩

숨김/비활성/`hidden` 클래스/display:none/zero clientRects 컨트롤은 포커스 목록에서 뺀다. `activeElement`가 목록 밖이면 앞방향 Tab은 첫 컨트롤, Shift+Tab은 마지막 컨트롤로 감싼다. 초기 포커스 `setTimeout`은 cleanup에서 `clearTimeout`한다.

### R4. committed out-parameter 제거

`let committed = null; setElements(prev => { committed = next; ... })` 패턴을 없앴다. `handleUpdateElement` / `handleUpdateElements` / `handleNudgeSelectedElements`는 `elementsRef.current`에서 다음 문서를 계산하고, ref와 `setElements(next)`를 같이 갱신한 뒤 그 값으로 히스토리를 남긴다. updater는 순수하게 쓰지 않으며, 동기 실행에 의존하지 않는다.

### R5. Fit nonce 일회성 + 안정 콜백

App의 `onZoomChange`를 인라인에서 `useCallback`으로 바꿨다. CanvasArea는 `lastFitNonceRef`와 `shouldApplyFitNonce`로 **새 Fit 요청만** 적용한다. 맞춤 모드가 아닐 때 ResizeObserver는 다시 맞추지 않는다. Fit 이후 100%·휠·객체 변경은 맞춤을 재가동하지 않는다.

### R6. 잠긴 자식이 있는 레이어 삭제 거절

`canDeleteLayer(layer, count, elements)`는 자식 중 `el.locked`가 있으면 false다. `handleDeleteLayer`는 그 경우 레이어와 자식을 그대로 두고 토스트를 띄운다. 레이어 패널 삭제 버튼도 비활성화한다. 캔버스 비우기와 같은 보호다.

### R7. 검증 픽스처 의존 제거

`scripts/verify-corrections.ts`는 `.ego-wol/fixes-20261029/review-fixture.json`을 읽지 않는다. `config`/`layer`/`rect` 빌더로 유효 프로젝트를 인라인한다.

## 검증

| 명령 | 결과 |
|---|---|
| `npm run lint` (`tsc --noEmit`) | 통과 |
| `npm run build` | 통과. 메인 JS 548.08 kB / gzip 154.17 kB. 500 kB 청크 경고는 여전함 |
| `npm run verify:svg` (tsx) | 통과 |
| SVG 검증 (esbuild 러너) | 통과 |
| 방사상 배열 | 12 케이스 통과 |
| 자동 크롭 | 14 passed, 0 failed |
| `scripts/verify-corrections.ts` | 히스토리·스키마(중첩 polyline/shadow/locked)·잠긴 자식 레이어 삭제·240/480×1920/4000 맞춤·clampManualZoom·fit nonce·포커스 트랩 전부 통과 |
| `.ego-wol/fixes-20261029/viewport-edge-review.ts` | 통과. 240×1920: zoom 0.0875, pan.x=48 (이전 pan.x=-108 / zoom 0.25) |
| `.ego-wol/fixes-20261029/schema-edge-review.ts` | 통과 (`PASS nested project shape validation`) |

tsx ENOMEM을 대비한 `scripts/run-node-esm.mjs`를 그대로 쓴다. 검증 후 `scripts/.tmp-*.mjs`는 남아 있지 않다.

Cursor CLI의 수정 후 주 에이전트가 별도 테스트 브라우저에서 실제 클릭·키보드·저장 결과를 검증했다. 기존 Ego 테스트 공간 종료 이후에는 Playwright 테스트 브라우저를 사용했다. Cursor 창은 조작하지 않았다.

| 브라우저 검증 | 결과 |
|---|---|
| 개발 StrictMode에서 그리드 토글 한 번 → Undo 한 번 | 원상 복구 통과 |
| Undo → 새 편집 | 새 편집 기록 및 Redo 분기 제거 통과 |
| 객체 선택 → 내보내기 → Delete·Ctrl+Z | 뒤쪽 객체 보존 통과 |
| 모달 진입·Tab/Shift+Tab·Esc·포커스 복원 | 내보내기·새 캔버스·단축키 안내 창 통과 |
| 잘못된 루트 JSON 및 polyline points `[null,null]` | 입력 거절, 기존 문서 보존, 오류 화면 미발생 |
| 잠긴 객체·잠긴 레이어 객체의 Delete | 객체 보존 통과 |
| 잠긴 자식이 있는 레이어 | 삭제 버튼 비활성화 확인 |
| Ctrl+D 후 프로젝트 저장 | 복제본 그룹 ID가 원본과 다름 확인 |
| 방향키 이동 후 Undo, 프로젝트 저장 결과 비교 | 이동 취소 후 객체 데이터 일치 |
| FHD 캔버스 Fit, 창 너비 800px로 축소 | 작업 영역 내 캔버스 수용 확인. 256px 스테이지에서 약 10% |
| Fit → 100% → 그리드 변경 → 창 크기 변경 | 수동 100% 유지 |
| 직선·화살표 제자리 클릭 | 객체 생성 안 됨. 실제 드래그는 선 1개 생성 |

최종 소스에서 타입 검사, 빌드, 신규 회귀, SVG, 방사상 12건, 자동 크롭 14건을 다시 통과했다. 테스트 브라우저 콘솔의 error 수준 메시지도 없었다. 실제 OS 클립보드 권한, 클립보드 안내 창의 OS 이미지 붙여넣기, 대용량 스트레스 및 여러 브라우저 호환성은 별도 확인이 필요하다.

## 변경 파일

**기존 파일**

- `src/App.tsx`
- `src/main.tsx`
- `src/components/CanvasArea.tsx` (기존 클릭-선 방지 로직 유지)
- `src/components/Toolbar.tsx` (기존 도형 버튼 통합만, 이번 작업에서 의도적으로 만지지 않음)
- `src/components/HeaderNavbar.tsx` (수동 줌 `clampManualZoom`)
- `src/components/ExportModal.tsx`
- `src/components/NewCanvasModal.tsx`
- `src/components/ShortcutsGuideModal.tsx`
- `src/components/ClipboardGuideModal.tsx`
- `src/components/PropertiesPanel.tsx`
- `src/components/LayersPanel.tsx` (잠긴 자식이 있으면 레이어 삭제 비활성)
- `src/utils/radialArray.ts`

**추가**

- `src/hooks/useDocumentHistory.ts`
- `src/utils/projectSchema.ts`
- `src/utils/lockGuards.ts`
- `src/utils/cloneElements.ts`
- `src/utils/viewportFit.ts`
- `src/utils/documentShortcuts.ts`
- `src/utils/documentSession.ts`
- `src/components/ModalDialog.tsx`
- `src/components/ErrorBoundary.tsx`
- `scripts/verify-corrections.ts`
- `scripts/run-node-esm.mjs`
- `document/2026-10-29-fix-results.md`

보존: `document/2026-10-29-app-audit.md`, `.ego-wol/`

## 남은 한계 / 미완

- `FIT_MIN_ZOOM`(0.01)보다 캔버스가 여전히 큰 병적 스테이지(예: 10px 뷰포트 × 4000px 캔버스)는 맞춤 후에도 넘칠 수 있다. 리뷰 케이스(240/480 × 1920/4000)는 들어간다.
- 일부 추가/레이어 핸들러는 여전히 렌더 클로저의 `elements`를 읽는다. 히스토리 out-parameter updater는 제거했지만, App 전체를 문서 리듀서로 바꾸지는 않았다.
- 잠긴 자식이 있는 레이어 삭제는 **거절**이다. 잠긴 객체만 다른 레이어로 옮기고 나머지만 지우는 규칙은 없다.
- 세션 안에서 만든 polyline의 `points`는 렌더러가 여전히 유효하다고 가정한다. 파일 로드 경로만 중첩 검증한다.
- 잠긴 객체의 속성 입력칸을 전부 `disabled`하지는 않았다. 명령 경로에서 거절하고 삭제/잠금/레이어 삭제 버튼만 UI로 막았다.
- 잠긴 객체의 복제(새 사본 생성)는 허용한다. 원본 수정은 막는다.
- 히스토리 스냅샷은 요소를 얕게 복사한다. 대부분의 편집은 새 객체를 만들지만, 제자리 변이가 있으면 과거 스냅샷과 공유될 수 있다.
- ErrorBoundary는 이 프로젝트에 `@types/react` 클래스 생성자 타입이 없어 `Component`를 `any`로 연결했다.
- 번들 500 kB 경고, 좁은 화면 패널, 다중 선택 UX, 자동 저장은 범위 밖이다.
