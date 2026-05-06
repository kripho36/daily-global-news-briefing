# 국제 정세 데일리 브리핑

Reuters, AP, BBC, The New York Times 기반 후보 기사를 모아 Groq API가 한국어 국제 정세 브리핑으로 정리하고, 날짜별 JSON 아카이브를 GitHub Pages에서 보여주는 정적 홈페이지입니다.

## 기능

- 매일 한국시간 07:00 자동 업데이트
- `data/YYYY-MM-DD.json`에 날짜별 요약본 저장
- 홈페이지에서 지난 날짜 클릭 후 해당 날짜 브리핑 열람
- 중요도 별점, 원본 링크, 내용, 영향, 전체 요약 제공
- Groq API 키가 없으면 원문 후보 목록만 임시 생성

## GitHub 설정

1. GitHub에서 새 저장소를 만듭니다.
2. 이 폴더의 파일을 해당 저장소에 올립니다.
3. 저장소 `Settings > Secrets and variables > Actions > New repository secret`에서 `GROQ_API_KEY`를 추가합니다.
4. 저장소 `Settings > Pages`에서 Source를 `GitHub Actions`로 설정합니다.
5. `Actions > Daily global news briefing > Run workflow`를 눌러 첫 브리핑을 수동 생성합니다.

매일 자동 실행 시간은 `.github/workflows/daily-briefing.yml`의 `cron: "0 22 * * *"`입니다. 이 값은 UTC 기준이며 한국시간 07:00에 해당합니다.

## 로컬 확인

```powershell
npm run generate
npm run serve
```

`GROQ_API_KEY`가 없는 로컬 실행은 실제 요약 대신 원문 후보 목록만 만듭니다.
Windows 실행 정책으로 `npm`이 막히면 아래처럼 직접 실행하면 됩니다.

```powershell
node scripts/generate-news.mjs
node scripts/dev-server.mjs
```

로컬에서 Groq 요약까지 확인하려면 PowerShell에서 한 번만 키를 넣고 실행합니다.

```powershell
$env:GROQ_API_KEY="gsk_..."
node scripts/generate-news.mjs
```

Reuters는 공개 RSS가 안정적으로 제공되지 않아 기본 스크립트에서는 Reuters 섹션 페이지 접근을 시도합니다. GitHub Actions 실행 환경에서도 차단된다면 Reuters 공식/상용 API 또는 합법적인 RSS 제공 서비스를 별도로 연결하는 방식이 가장 안정적입니다.

## 데이터 형식

```json
{
  "date": "2026-05-06",
  "generatedAtKst": "2026. 5. 6. 오전 7:00",
  "sources": ["Reuters", "AP", "BBC", "NYT"],
  "title": "2026-05-06 국제 정세 브리핑",
  "overallSummary": "오늘 전체 뉴스 흐름 요약",
  "sections": [
    {
      "heading": "🌍 글로벌 & 미국 정세",
      "items": [
        {
          "title": "한국어 제목",
          "importance": 5,
          "source": "Reuters",
          "url": "https://...",
          "originalTitle": "Original headline",
          "content": "내용 요약",
          "impact": "영향 분석"
        }
      ]
    }
  ]
}
```

## 운영 메모

RSS 기사 후보만으로는 전문 기사 전체를 읽는 것이 아니므로, 요약은 제목과 RSS 설명에 근거합니다. 더 깊은 요약이 필요하면 유료 뉴스 API, RSS 전문 제공 서비스, 또는 합법적인 원문 접근 API를 연결하는 방식으로 확장하는 것이 좋습니다.
