# 작업 내역

## 2026-09-03 ~ 09-04 — 지수 웹앱 초기 구축

토스 증권 다크 모드를 벤치마킹한 지수 시세 앱을 처음부터 만들었다.
대상 지수는 나스닥 종합 · S&P 500 · 비트코인 · 코스피 · 코스닥 5종.

### 1. 프로토타입 (→ `legacy/`)

- 의존성 없는 단일 HTML/JS로 먼저 만들어 화면 구성과 차트 엔진을 검증
- 캔버스 캔들차트, 일/주/월봉, MA5·20·60·120, 거래량, 크로스헤어, 핀치 줌
- 시드 고정 모의 시세 생성기(GBM + 변동성 레짐 + 갭)
- Next.js로 옮긴 뒤 `legacy/` 로 이동, 빌드에서 제외

### 2. 데이터 소스 조사 (→ `docs/DATA-APIS.md`)

- 5개 지수를 한 번에 커버하는 무료 소스는 **Yahoo Finance chart API** — 단, 비공식이고 CORS 미허용
- 코인은 **Binance / Upbit** 가 브라우저 직접 호출 가능(CORS 허용)
- 국내 상용은 **KIS Open API**, 공식 데이터는 **KRX / 공공데이터포털**
- 시세 외에 필요해질 API(펀더멘털·매크로·뉴스·환율·온체인·지표)와
  보조지표 분류표를 함께 정리

### 3. 기술 스택 결정

- MVP는 **TypeScript 단일 언어**로 프론트 + API를 덮고, 지표 리서치가 필요해지면 Python 보조
- 실시간 수집이 병목이 될 때만 Go, Rust는 MVP 범위에서 제외
- 국내 금융권 연동/사내 표준이 전제면 Kotlin + Spring 이 대안

### 4. Next.js 15 + TypeScript 재구성

- App Router, 서버 컴포넌트 + 5분 ISR, CSS Modules (차트 라이브러리 의존성 0)
- 홈: 시장 요약, 가로 스크롤 지수 카드(60일 스파크라인), 해외/국내/코인 필터,
  순위형 리스트, 하단 고정 탭바
- 상세: 큰 현재가/등락 → 차트 → 기간 칩 → 지표 컨트롤 → 시세 요약 → 지표 해설
- 차트 엔진을 TS로 포팅하며 **볼린저밴드 오버레이**와
  **보조지표 서브패널(거래량 / RSI / MACD)** 추가
- 지표 구현: SMA · EMA · RSI · MACD · 볼린저 · 스토캐스틱 · ATR · OBV (`src/lib/indicators.ts`)

### 5. 실데이터 연결

- 외부 호출을 전부 **서버(서버 컴포넌트 · Route Handler)** 로 옮겨 CORS 프록시 제거
- `DATA_SOURCE=auto` 기본값: 코인 = Binance, 지수 = Yahoo, 실패 시 모의 데이터 폴백
- 응답의 `source` 를 화면에 `실시세 / 모의` 배지로 노출
- 주봉·월봉은 서버에서 따로 받지 않고 일봉을 `aggregate()` 로 집계 →
  **어떤 소스든 일봉만 채우면** 세 봉과 모든 지표가 동작
- 모의 데이터의 기준가를 실제 시세 수준으로 맞춤(폴백 시 위화감 제거)

### 검증한 것

| 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | 통과 |
| `npx next build` | 통과 (홈 static, `/quote/[id]` SSG 5종, API dynamic) |
| `/api/candles/KS11` | `source: yahoo`, 2447봉, 최신 2026-09-04 |
| `/api/candles/BTC` | `source: binance`, 1000봉 |
| `/`, `/quote/IXIC` | HTTP 200 |
| 모의 데이터 생성기 | OHLC 정합성(고가 ≥ 시/종가 ≥ 저가), 주/월봉 집계 개수 확인 |

**미검증**: 헤드리스 브라우저가 없어 실제 렌더링 화면은 눈으로 확인하지 못했다.
`npm run dev` 로 띄워 레이아웃·터치 제스처를 확인해야 한다.

### 다음에 할 만한 것

1. 실기기에서 렌더링/제스처 확인 및 미세 조정
2. 관심 지수 등록(로컬 스토리지 → 이후 계정 연동)
3. 홈에 FRED 기반 금리·VIX 한두 개 배치
4. 종목 상세 하단 뉴스 5건 (네이버 검색 API / Finnhub)
5. 상용화 시 데이터 소스를 KIS Open API + 유료 해외 벤더로 교체 (`src/lib/sources.ts` 한 곳)

### 다른 작업실에서 이어받기

```bash
git clone https://github.com/minwo/trade-project3.git
cd trade-project3
npm install
npm run dev        # http://localhost:3000
```

`.env.local` 은 커밋하지 않는다. 기본값이 `auto` 라 없어도 실데이터로 동작하고,
네트워크가 막힌 환경에서는 `DATA_SOURCE=mock` 을 넣으면 된다.
