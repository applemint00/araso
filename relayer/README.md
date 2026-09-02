# Araso relayer (로컬 개발용)

가스 grant 릴레이어. 사용자 주소당 0.1 MON(`policy.mjs` `GRANT_WEI`)을 1회만 밀어준다(Monad Testnet).
tx 는 단순 native transfer — 컨트랙트 호출도, 사용자 tx 대납도 아니다.

**배포 경로는 이 서버가 아니다.** 프로덕션에서 앱이 부르는 것은 같은 origin 의 서버리스
`api/grant.js` 이고, 이 디렉터리는 로컬 개발·정책 검증(`policy.mjs`)·smoke 테스트용으로 남긴다.
두 경로는 `relayer/src/policy.mjs` 를 공유하지만, 서버리스에는 원장 파일이 없다(무상태 판정으로 대체 —
`api/grant.js` 머리말 참조).

## 엔드포인트

- `GET /health` → `{"ok":true}`
- `POST /grant` `{"address":"0x..."}` → `{"ok":true,"txHash":"0x..."}` 또는 `{"ok":false,"error":"..."}`

## 실행

```
RELAYER_PRIVATE_KEY=<placeholder> PORT=8787 node relayer/src/server.mjs
```

키는 환경변수로만 넘긴다(`--env-file` 등). 파일로 만들지 않는다. 없으면 기동을 거부한다.
앱을 이 로컬 서버에 붙이려면 `VITE_RELAYER_URL=http://localhost:8787` — 안 주면 앱은 `/api` 를 쓴다.

## 테스트

```
node relayer/test/smoke.mjs
```

네트워크·실키 접촉 없이 가짜 submitter 로 서버 로직만 검증한다.
