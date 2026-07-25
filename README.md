# 고스톱 장부

카카오톡 대화방 스크린샷에서 고스톱 정산 메시지를 브라우저 OCR로 추출하고, 검토한 판을 날짜별로 보관하는 모바일 우선 정적 웹앱입니다.

사진·OCR 텍스트·게임 기록을 외부 API로 전송하지 않습니다. OCR, 파싱, IndexedDB 저장, 누적 통계와 송금 목록 계산이 모두 사용자의 브라우저 안에서 동작합니다.

## 주요 기능

- JPG·PNG·WEBP 스크린샷 최대 10장 선택, 순서 변경, 중복 SHA-256 감지
<!-- Original: Tesseract.js Web Worker 기반 한국어·영어 로컬 OCR과 이미지별 진행률·취소 -->
- PaddleOCR.js Web Worker와 한국어 PP-OCRv5 모바일 모델 기반 로컬 OCR·취소
- `승자 / 패자 -금액` 형식의 규칙 기반 파싱과 불확실한 판 확인
- 판 추가·삭제·순서 변경, 승패·금액 수정, 실시간 손익·송금 미리보기
- 날짜별 게임, 판, 참가자, 별칭, 정산 완료 상태를 IndexedDB에 영구 저장
- 누적 순위, 게임 수, 승·패·무, 최고 수익·최대 손실 통계
- 참가자 이름 수정, 별칭 등록, 중복 참가자 병합과 충돌 방지
- JSON 전체 백업·병합/교체 복원, UTF-8 BOM CSV 내보내기
- HashRouter, GitHub Pages 하위 경로, 다크 모드, 오프라인 앱 shell, 설치형 PWA
- 파서·정산·OCR 후처리·IndexedDB 단위 테스트와 Playwright 모바일 핵심 흐름

## 정적 구조를 선택한 이유

<!-- Original: GitHub Pages는 정적 HTML, CSS, JavaScript만 제공합니다. 따라서 FastAPI, 서버 PaddleOCR, 서버 SQLite는 실행할 수 없습니다. 이 프로젝트는 React + TypeScript + Vite, Tesseract.js, Dexie/IndexedDB로 구성되어 별도 서버 비용이나 비밀키가 필요 없습니다. -->
GitHub Pages는 정적 HTML, CSS, JavaScript만 제공합니다. 따라서 FastAPI, Python PaddleOCR, 서버 SQLite는 실행할 수 없습니다. 이 프로젝트는 React + TypeScript + Vite, 브라우저용 PaddleOCR.js, Dexie/IndexedDB로 구성되어 별도 서버 비용이나 비밀키가 필요 없습니다.

## 지원 환경

- 최신 Chrome, Edge, Safari, Firefox
- iOS 16 이상 Safari, 최신 Android Chrome 권장
- OCR은 메모리와 CPU를 많이 사용하므로 오래된 휴대폰에서는 이미지를 한두 장씩 처리하는 편이 안정적입니다.

## 로컬 실행

Node.js 20 이상이 필요합니다.

```bash
npm ci
npm run dev
```

<!-- Original: 개발 주소가 표시되면 브라우저에서 엽니다. 첫 OCR 실행은 한국어·영어 모델 약 수십 MB를 로드하므로 네트워크와 기기에 따라 시간이 걸립니다. 이후 브라우저 캐시를 재사용합니다. -->
개발 주소가 표시되면 브라우저에서 엽니다. 첫 OCR 실행은 PaddleOCR.js 실행 파일과 한국어 PP-OCRv5 모델 약 50MB 이상을 로드하므로 네트워크와 기기에 따라 시간이 걸립니다. 이후 브라우저 캐시를 재사용합니다.

검사 명령:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

GitHub Pages와 같은 하위 경로를 로컬에서 확인하려면:

```bash
VITE_BASE_PATH=/go-stop-money/ npm run build
npm run preview
```

## OCR 모델과 라이선스

<!-- Original: `public/tessdata/kor.traineddata.gz`와 `eng.traineddata.gz`는 Project Naptha/Tesseract tessdata 4.0.0 계열 모델입니다. Tesseract.js 및 모델의 라이선스는 Apache License 2.0입니다. 앱은 `import.meta.env.BASE_URL` 아래의 모델을 읽으므로 GitHub Pages 프로젝트 하위 경로에서도 동작합니다. -->
`public/models`에는 공식 `PP-OCRv5_mobile_det` 문자 검출 모델과 `korean_PP-OCRv5_mobile_rec` 한국어 인식 모델이 들어 있습니다. PaddleOCR.js와 PaddleOCR 모델은 Apache License 2.0이며, 모델·WASM 파일은 `import.meta.env.BASE_URL` 아래에서 읽으므로 GitHub Pages 프로젝트 하위 경로에서도 동작합니다. 기존 Tesseract 모델 파일은 변경 이력 보존을 위해 남겨두었지만 앱에서는 사용하지 않습니다.

정확도 한계:

- 카카오톡 글자가 작거나 압축된 이미지, 움직임 흔들림, 강한 테마 배경은 인식률이 떨어집니다.
- OCR 결과는 자동 확정되지 않습니다. 신뢰도가 낮거나 중복이 의심되는 판은 사용자가 확인해야 저장됩니다.
- 사진은 처리 중 메모리에만 유지하며 게임 저장 시 원본을 IndexedDB에 넣지 않습니다.

## GitHub Pages 배포

1. GitHub에서 빈 저장소를 만들고 이 프로젝트를 `main` 브랜치에 push합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택합니다.
3. Actions 탭의 `GitHub Pages 배포` 작업이 끝나면 `https://<사용자>.github.io/<저장소>/`로 공개됩니다.

워크플로는 `npm ci` 후 lint, TypeScript, 단위·통합 테스트, production build와 Playwright를 모두 통과한 경우에만 Pages artifact를 배포합니다. 권한은 소스 읽기와 Pages 배포에 필요한 `pages: write`, `id-token: write`만 사용합니다.

Vite는 Actions가 제공하는 `GITHUB_REPOSITORY`에서 저장소 이름을 읽습니다.

- 사용자 사이트 저장소가 `<사용자>.github.io`이면 base는 `/`
- 프로젝트 사이트 저장소이면 base는 `/<저장소>/`
- 사용자 지정 경로는 `VITE_BASE_PATH`로 지정 가능

HashRouter를 사용하므로 `#/history` 같은 주소를 새로고침해도 Pages 404가 발생하지 않습니다. `public/404.html`도 루트 복귀용으로 포함합니다.

## 데이터 백업과 기기 이동

기록은 브라우저의 IndexedDB에만 있습니다. 사이트 데이터 삭제, 비공개 모드 종료, 기기 분실 시 사라질 수 있습니다.

1. 현재 기기의 **보관함 → JSON 백업 → 백업 파일 받기**
2. 새 기기에서 같은 사이트 열기
3. **보관함 → JSON 복원 → 기존 기록과 합치기** 또는 **전체 교체**

CSV는 스프레드시트 분석용이며 완전한 복원에는 JSON 백업을 사용해야 합니다. 원본 스크린샷은 백업에 포함되지 않습니다.

## 개인정보와 공개 저장소 주의

- 외부 OCR/AI API, 분석 도구, 광고 SDK, 원격 로그를 사용하지 않습니다.
- 이미지 내용을 콘솔이나 서버에 기록하지 않습니다.
- 사용자가 입력한 텍스트를 HTML로 직접 주입하지 않습니다.
- JSON 가져오기는 스키마 버전, ID 참조, 손익 합계를 검증합니다.
- GitHub Pages 소스와 빌드 산출물은 공개될 수 있으므로 비밀키나 개인 데이터를 저장소에 올리지 마세요.

## 문제 해결

<!-- Original: **OCR 모델 404**: 저장소의 `public/tessdata` 파일이 push되었는지, Pages 주소가 저장소 하위 경로인지 확인합니다. -->
- **OCR 모델 404**: 저장소의 `public/models`와 `public/ort` 파일이 push되었는지, Pages 주소가 저장소 하위 경로인지 확인합니다.
- **첫 OCR이 느림**: Wi‑Fi에서 한 번 모델을 받은 후 다시 시도합니다. 고해상도 사진 수를 줄이면 메모리 사용량이 감소합니다.
- **기록이 안 보임**: 같은 도메인과 브라우저인지 확인합니다. 사용자 사이트와 프로젝트 사이트는 서로 다른 IndexedDB를 씁니다.
- **Pages가 빈 화면**: Actions의 모든 검사 통과 여부와 Settings의 Pages Source가 GitHub Actions인지 확인합니다.
- **브라우저 저장소 오류**: 저장 공간을 확보하고 JSON 백업 후 사이트 데이터 초기화를 시도합니다.

---

<!-- ORIGINAL_STARTER_README
# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
ORIGINAL_STARTER_README -->
