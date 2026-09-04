# 지수 웹앱 (Next.js + TypeScript)

토스 증권 다크 모드를 벤치마킹한 지수 시세 앱.
나스닥 · S&P 500 · 비트코인 · 코스피 · 코스닥을 홈에서 보고,
상세에서 **일봉 / 주봉 / 월봉 + 이동평균선 + 보조지표(거래량 · RSI · MACD · 볼린저밴드)** 를 확인한다.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build && npm start
npm run typecheck
```

## 구조

```
src/
  app/
    layout.tsx                 앱 셸 + 하단 탭바
    page.tsx                   홈 (서버 컴포넌트, 5분 ISR)
    quote/[id]/page.tsx        지수 상세 (SSG + 5분 ISR)
    api/candles/[id]/route.ts  일봉 API — 서버에서 외부 시세를 호출하므로 CORS·키 노출 없음
    globals.css                다크 테마 디자인 토큰
  components/
    HomeScreen.tsx             가로 스크롤 카드 + 순위 리스트 + 필터
    QuoteScreen.tsx            가격 헤더 · 차트 · 지표 컨트롤 · 시세 요약 · 지표 해설
    Sparkline.tsx  TabBar.tsx
  lib/
    chart/CandleChart.ts       캔버스 차트 엔진 (캔들·라인·MA·볼린저·서브패널·크로스헤어·핀치줌)
    chart/theme.ts             캔버스 팔레트 / MA 정의
    indicators.ts              SMA EMA RSI MACD 볼린저 스토캐스틱 ATR OBV
    series.ts                  일봉 → 주봉/월봉 집계, 52주 통계
    sources.ts                 데이터 소스 어댑터 (서버 전용)
    mock.ts                    시드 고정 모의 시세 (폴백용)
legacy/                        최초 프로토타입(순수 HTML/JS) — 빌드 제외
docs/DATA-APIS.md              투자 데이터 API · 보조지표 레퍼런스
```

차트 라이브러리 의존성은 없다. `package.json` 은 next / react / react-dom 뿐이다.

## 데이터 소스

`DATA_SOURCE` 환경변수로 고른다. 기본값 `auto`.

| 값 | 동작 |
|---|---|
| `auto` (기본) | 코인 = **Binance**, 지수 = **Yahoo Finance**, 실패하면 모의 데이터로 폴백 |
| `yahoo` | 전부 Yahoo Finance |
| `mock` | 전부 모의 데이터 (네트워크 불필요) |

```bash
# .env.local
DATA_SOURCE=auto
```

외부 호출은 전부 **Next 서버(Route Handler / 서버 컴포넌트)** 에서 일어난다.
그래서 브라우저 CORS 프록시가 필요 없고, 나중에 KIS·공공데이터포털처럼 **키가 필요한 소스**로
바꿔도 키가 클라이언트에 노출되지 않는다. 교체 지점은 [`src/lib/sources.ts`](src/lib/sources.ts) 한 곳이다.

응답에 `source` 필드가 실려 오고, 화면 우상단 배지와 상세 헤더에 `실시세 / 모의` 로 표시된다.

주봉·월봉은 서버에서 따로 받지 않고 일봉을 [`aggregate()`](src/lib/series.ts) 로 묶어 만든다.
**일봉만 채워주면** 세 봉과 모든 지표가 동작한다.

## 화면

- **홈** — 시장 요약, 가로 스크롤 지수 카드(60일 스파크라인), 해외/국내/코인 필터, 순위형 리스트, 하단 탭바
- **상세** — 큰 현재가와 등락, 일/주/월봉 · 캔들/라인 전환, 기간 칩, MA5·20·60·120 토글, 볼린저밴드,
  보조지표 서브패널(거래량 / RSI / MACD), 크로스헤어(마우스 hover · 터치 드래그), 휠·핀치 확대,
  52주 최고·최저 등 시세 요약, 지표 읽는 법
- 상승 빨강 / 하락 파랑 (국내 증권앱 관례)

## 참고 문서

- [docs/DATA-APIS.md](docs/DATA-APIS.md) — 시세·펀더멘털·매크로·뉴스·지표 API 목록과 보조지표 정리

> 무료 공개 API의 지연 시세이거나 모의 데이터다. 실제 투자 판단에 사용하지 말 것.
