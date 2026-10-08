# A-906 relayer expectations (an internal interface record exists; these notes are the public summary)
POST /gift-sponsor (default OFF) body, exactly 4 keys:
- giftId: lowercase 0x bytes32
- authorization: { chainId:number, address, nonce, r, s, yParity:0|1 }  (7702 tuple; address = pinned StatelessDeleGator impl)
- delegation: { delegate (=sponsor), delegator (=Piggy), authority (=0xff..ff), caveats:[ExactExecution, LimitedCalls, Timestamp] each {enforcer,terms,args:"0x"}, salt (decimal string), signature }
- claim: { recipient (=delegator), preimage (hex), salt (bytes32), deadline (decimal) }  -- claim() needs these; the commit hash in ExactExecution is keccak(abi.encode(recipient,preimage,salt))
Expiry caveat = MetaMask TimestampEnforcer, terms = packed(uint128 after=0, uint128 before). Max window = injected maxExpirySeconds (UNKNOWN, refused when missing).
Responses: 200 CLAIMED | 400 bad_request | 409 not_available (every guard refusal, incl. replay) | 503 unavailable / unavailable_not_sent.

## Update (review A-906 F1/F3/F4/F5)
- Success response: 200 `{ok, state:"CLAIMED", giftId, installTxHash|null, commitTxHash, claimTxHash, txHash}`. commitTxHash = the redeemDelegations tx (commitClaim executed from the Piggy). txHash == claimTxHash (kept for older readers).
- Install is a SEPARATE sponsor type-4 tx to the Piggy (value 0, data 0x, authorizationList), before the redeem tx to the DelegationManager. CHOSEN: separate txs, matching A-814 Part F; installTxHash is null when the Piggy already carries the impl designator.
- Caveat order is fixed: ExactExecution, LimitedCalls, Timestamp; Timestamp `after` must be 0.
- Policy chainId must be 143 or 10143 and all addresses/hashes must equal the relayer pin table (own copy). Timestamp code hash 143 = 0x1da353...900c is FORK-READ; on 10143 it is UNKNOWN and injected.
- Queue is bounded (injected `maxQueue`, default 8): when full => 503 `unavailable_not_sent`.

## A-913 update (relayer side) — supersedes the 4-key / always-on notes above
- Hosting: same-origin Vercel function `api/gift-sponsor.js` runs the service in-process (no shared-secret header, no always-on process); ledger = Vercel KV; recovery = Cron `api/gift-sponsor-reconcile.js`.
- Wire request is now exactly 6 keys: `giftId, authorization, revokeAuthorization, delegation, claim, gasTx`. `revokeAuthorization` = Piggy-signed type-4 `{chainId (same), address 0x0, nonce = authorization.nonce + 1, r, s, yParity}`; `gasTx` = hash of the sender's plain gas-deposit tx.
- `authorization.nonce` must equal the Piggy's chain nonce at the relayer (the install tx is always sent, even if the designator is already present, so the revoke nonce lines up).
- Expiry: Timestamp `after = 0`, `before = min(now + 300, Gift expiry)`; relayer refuses `before - chainNow > 300` and `before > Gift expiry`.
- G10: `gasTx` receipt status success, `from` = Gift sender, `to` = pinned sponsor, `value >= (install+commit+revoke+claim units) x current fee x (1+buffer)`; no fee input => refuse. One deposit tx per giftId.
- Success body adds `revoke` ("done"|"failed"|"unsure") and `revokeTxHash` (string|null). Tx order: install, commit (redeemDelegations), revoke (type-4 to the Piggy), claim.
- Statuses: 200 | 400 bad_request | 409 not_available | 503 unavailable_not_sent (nothing sent; safe to retry later; also busy lease, preflight mismatch, balance below floor, no fee input) | 503 unavailable (something may have landed: re-read the chain, do not blindly resend).
- Revoke never blocks claim; the signed revoke authorization is never sent to `eth_estimateGas` / `eth_call`.
