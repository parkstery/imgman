# imgman 래스터 이미지 SVG 벡터화 구현 명세

## 목표

imgman이 직접 생성한 도형, 선, 브러시, 텍스트의 기존 SVG 직렬화는 유지한다.
PNG/JPEG/WebP로 삽입된 `ImageElement`에는 선택적인 래스터 트레이싱 단계를 추가한다.
"벡터화" 모드로 저장한 SVG에는 `<image>` 태그와 `data:image` 페이로드가 없어야 한다.

기준 샘플은 `C:\Users\kdrea\Downloads\im-261026-003818.svg`이다. 이 파일은 451×451 PNG를 `<image>`로 감싼 파일이며, 투명 배경과 짙은 파랑/흰색 위주의 단순 로고다.

## 설계 원칙

1. `shape`, `brush`, `text`의 기존 네이티브 벡터 출력은 보존한다.
2. `image` 분기와 SVG 내보내기 전처리만 선택적으로 교체한다.
3. 트레이싱 엔진은 독립 인터페이스 뒤에 격리해 나중에 교체 가능하게 한다.
4. 래스터 출력(PNG/JPEG/WebP)은 동작을 바꾸지 않는다.
5. 순수 벡터 모드에서 트레이싱 실패 시 조용히 래스터로 폴백하지 않는다. 다운로드를 중단하고 실패 원인을 표시한다.
6. 기존 프로젝트 JSON의 `ImageElement` 형식은 깨뜨리지 않는다. 벡터화는 내보내기 시점에 수행한다.
7. 복잡한 사진은 경로 폭증을 방지할 제한과 경고를 둔다.

## 권장 구조

- `src/utils/rasterVectorizer.ts`: 이미지 디코딩, 필터 적용, 트레이싱, 안전한 SVG fragment 생성
- 필요 시 `src/workers/vectorize.worker.ts`: 동기 트레이서로 인한 UI 정지 방지
- `src/utils/svgExport.ts`: 기존 직렬화 보존, 비동기 SVG 내보내기 상위 함수와 벡터 fragment 삽입 지원
- `src/components/ExportModal.tsx`: 이미지 처리 모드, 프리셋, 진행/오류/결과 보고
- `src/types.ts` 또는 별도 타입 파일: 옵션과 결과 보고 타입
- `scripts/verify-svg-export.ts`: 실제 벡터 여부 및 회귀 검증 강화

권장 API 예시:

```ts
type RasterHandling = 'preserve' | 'vectorize' | 'skip';

interface VectorizeOptions {
  preset: 'logo' | 'illustration';
  maxColors: number;
  alphaThreshold: number;
  despeckle: number;
  simplifyTolerance: number;
  maxDimension: number;
}

interface SVGExportReport {
  vectorizedImageCount: number;
  rasterImageCount: number;
  pathCount: number;
  warnings: string[];
}
```

## 구현 전 함께 고칠 기존 결함

1. `encodeXML()`이 `&`, `<`, `>`, `"`를 실제 XML 엔티티로 바꾸지 않는다.
2. `simplifyTolerance`, `brushSampleDistance` 옵션이 선언되어 있지만 내부 계산에는 고정값이 사용된다.
3. Data URL에서 `imageMode: 'link'`는 `embed`와 실제 동작이 같다.
4. SVG 투명 배경 상태가 일반 `transparent`와 `svgOptions.transparentBackground`로 중복되어 다운로드 시 값이 덮어써진다.
5. ExportModal의 "항상 순수 벡터" 문구는 래스터 이미지가 남을 때 사실이 아니다.
6. 이미지 corner radius/border 관련 계산은 있으나 SVG에 적용되지 않는다.

## 기준 로고 기본값

- 프리셋: logo
- 최대 색상: 4
- 알파 임계값: 약 8/255
- 작은 조각 제거: 약 4px
- 곡선 단순화 허용 오차: 1.0~1.5px
- 투명 배경 유지
- 원본의 흰색 내부 영역 유지

## 필수 수용 조건

1. 기준 로고를 벡터화 모드로 내보낸 SVG에 `<image`와 `data:image`가 없다.
2. 출력에 실제 `<path>`가 있고 짙은 파랑, 흰색, 투명 배경이 시각적으로 유지된다.
3. 기존 shape/brush/text 출력 회귀가 없다.
4. 이미지 위치, 표시 크기, 회전, flipH/flipV, opacity가 유지된다.
5. 순수 벡터 모드 실패는 명시적 오류이며 래스터 폴백이 아니다.
6. 혼합 모드는 사용자가 명시적으로 선택했을 때만 `<image>`를 허용한다.
7. `npm run lint`와 `npm run build`가 통과한다.
8. 검증 스크립트가 결과 SVG를 파싱하고 순수 벡터 조건을 자동 확인한다.
9. 다운로드 UI가 순수 벡터인지 혼합 SVG인지 사실대로 표시한다.

## 구현 전략

우선 브라우저에서 동작하는 컬러 트레이서로 MVP를 완성한다. 트레이서 종속 코드는 어댑터 안에 제한한다. 패키지 추가가 필요하면 이유와 라이선스, 브라우저/Vite 호환성을 확인하고 최소 의존성만 추가한다. Web Worker가 첫 구현을 과도하게 복잡하게 만들면 기능과 테스트를 먼저 완성한 뒤 별도 단계로 추가할 수 있지만, 큰 입력에 대한 픽셀/경로 제한은 첫 구현에 포함한다.

## 작업 방식

- 관련 없는 파일이나 기존 사용자 변경을 수정하지 않는다.
- 기존 공개 함수의 호출부를 모두 검색한 뒤 시그니처를 바꾼다.
- 큰 일괄 재작성보다 작은 단계로 구현하고 각 단계마다 타입 검사한다.
- 샘플 로고를 테스트 fixture로 사용할 때 원본 파일을 변경하지 않는다.
- 구현 완료 후 변경 파일, 설계 선택, 테스트 결과, 남은 제한을 보고한다.
