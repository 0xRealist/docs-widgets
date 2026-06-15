# docs-widgets

Standalone, embeddable widgets for the Areal / RWT documentation. Each widget is a static page
under its own folder and is embedded in the docs via an `<iframe>`. Hosted on GitHub Pages.

## Widgets

| Widget | Path | URL |
|---|---|---|
| RWT Book NAV | `book-nav/` | `https://0xrealist.github.io/docs-widgets/book-nav/` |

### book-nav

A live overview of RWT, read directly from Solana mainnet:

- **Book NAV Price** (live) — `getAccountInfo` on the `EarnConfig` PDA
  `5GyVeryGnTPPtfteYaj5pNUjE9s2DDDpDnccgoFjV8L3` → `total_invested_capital` (u128 LE at offset 8),
  divided by `getTokenSupply` of the RWT mint `RWTeFt9M635Tf6w6yveAoXQR2ZwfXs7MfA7W3grDuGT`.
  Refreshes every 30s.
- **Invested capital** and **Supply** — live.
- **Book NAV chart** and **Holders** — read from `book-nav/history.json`.

Browser-side calls use the CORS-enabled public RPC `https://solana-rpc.publicnode.com`
(`api.mainnet-beta` blocks browser requests). Swap `RPC` in `book-nav/index.html` for a dedicated
endpoint (Helius / Triton / QuickNode) for production reliability.

#### History / snapshots

The chain stores only current state, so the chart is fed by daily snapshots in
`book-nav/history.json`, appended by `scripts/snapshot.mjs` via the `snapshot` GitHub Action
(`.github/workflows/snapshot.yml`, runs daily + on manual dispatch). The snapshot job runs
server-side and can use heavier RPC methods (`getProgramAccounts`) to count holders. An optional
`RPC_URL` repo secret overrides the RPC the job uses.

## Embed

```html
<iframe src="https://0xrealist.github.io/docs-widgets/book-nav/"
        style="width:100%;height:360px;border:none" loading="lazy"></iframe>
```
