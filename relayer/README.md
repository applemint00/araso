# Araso relayer

가스 grant 릴레이어. 사용자 주소당 0.2 MON 을 1회만 밀어준다(Monad Testnet).
tx 는 단순 native transfer — 컨트랙트 호출도, 사용자 tx 대납도 아니다.

## 엔드포인트

- `GET /health` → `{"ok":true}`
- `POST /grant` `{"address":"0x..."}` → `{"ok":true,"txHash":"0x..."}` 또는 `{"ok":false,"error":"..."}`

## 실행

```
RELAYER_PRIVATE_KEY=<placeholder> PORT=8787 node relayer/src/server.mjs
```

키는 환경변수로만 넘긴다(`--env-file` 등). 파일로 만들지 않는다. 없으면 기동을 거부한다.

## 테스트

```
node relayer/test/smoke.mjs
```

네트워크·실키 접촉 없이 가짜 submitter 로 서버 로직만 검증한다.
