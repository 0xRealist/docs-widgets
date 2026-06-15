// Daily snapshot of RWT Book NAV → book-nav/history.json
// Runs server-side (GitHub Actions), so it may use RPC methods browsers can't
// (getProgramAccounts for holder count, api.mainnet-beta, etc.).
import { readFileSync, writeFileSync } from "node:fs";

const RPC = process.env.RPC || "https://api.mainnet-beta.solana.com";
const CONFIG = "5GyVeryGnTPPtfteYaj5pNUjE9s2DDDpDnccgoFjV8L3"; // EarnConfig PDA
const MINT = "RWTeFt9M635Tf6w6yveAoXQR2ZwfXs7MfA7W3grDuGT"; // RWT mint
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const FILE = new URL("../book-nav/history.json", import.meta.url);

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error));
  return j.result;
}

async function main() {
  const acc = await rpc("getAccountInfo", [CONFIG, { encoding: "base64" }]);
  const bin = Buffer.from(acc.value.data[0], "base64");
  let capital = 0n; // total_invested_capital: u128 LE at offset 8
  for (let i = 0; i < 16; i++) capital += BigInt(bin[8 + i]) << (8n * BigInt(i));

  const sup = await rpc("getTokenSupply", [MINT]);
  const supply = BigInt(sup.value.amount);

  const nav = supply === 0n ? 1 : Number((capital * 1000000n) / supply) / 1e6;

  let holders = null;
  try {
    const accs = await rpc("getProgramAccounts", [
      TOKEN_PROGRAM,
      { encoding: "jsonParsed", filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: MINT } }] },
    ]);
    holders = accs.filter((a) => Number(a.account.data.parsed.info.tokenAmount.amount) > 0).length;
  } catch (e) {
    console.warn("holders lookup failed:", e.message);
  }

  const t = new Date().toISOString().slice(0, 10);
  const point = {
    t,
    nav: Number(nav.toFixed(6)),
    capital: Math.round(Number(capital) / 1e6),
    supply: Math.round(Number(supply) / 1e6),
  };
  if (holders !== null) point.holders = holders;

  const data = JSON.parse(readFileSync(FILE, "utf8"));
  data.points = data.points || [];
  const last = data.points[data.points.length - 1];
  if (last && last.t === t) data.points[data.points.length - 1] = point;
  else data.points.push(point);

  writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
  console.log("snapshot", JSON.stringify(point));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
