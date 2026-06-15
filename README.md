# docs-widgets

Standalone, embeddable widgets for the Areal / RWT documentation. Each widget is a static page
under its own folder and is embedded in the docs via an `<iframe>`. Hosted on GitHub Pages.

## Widgets

| Widget | Path | URL |
|---|---|---|
| RWT Book NAV | `book-nav/` | `https://0xRealist.github.io/docs-widgets/book-nav/` |

### book-nav

Live **Book NAV Price** of RWT, read directly from Solana mainnet:

- `getAccountInfo` on the `EarnConfig` PDA `5GyVeryGnTPPtfteYaj5pNUjE9s2DDDpDnccgoFjV8L3`
  → `total_invested_capital` (u128 LE at offset 8).
- `getTokenSupply` on the RWT mint `RWTeFt9M635Tf6w6yveAoXQR2ZwfXs7MfA7W3grDuGT`.
- `Book NAV Price = total_invested_capital / supply` (both 6 decimals). Refreshes every 30s.

The default RPC is the public `api.mainnet-beta.solana.com` (rate-limited). For production, edit
`RPC` in `book-nav/index.html` to a dedicated endpoint (Helius / Triton / QuickNode).

## Embed

```html
<iframe src="https://0xRealist.github.io/docs-widgets/book-nav/"
        style="width:100%;height:120px;border:none" loading="lazy"></iframe>
```
