// Daily snapshots → book-nav/history.json and strwt/history.json
// Runs server-side (GitHub Actions), so it may use RPC methods browsers can't
// (getProgramAccounts for holder counts, api.mainnet-beta, etc.).
import { readFileSync, writeFileSync } from "node:fs";

const RPC = process.env.RPC || "https://api.mainnet-beta.solana.com";
const EARN = "5GyVeryGnTPPtfteYaj5pNUjE9s2DDDpDnccgoFjV8L3"; // EarnConfig PDA
const RWT = "RWTeFt9M635Tf6w6yveAoXQR2ZwfXs7MfA7W3grDuGT"; // RWT mint
const STRWT = "sRWTy1bkqvRegb31RETanhbAtJ7eXN6XsTvaqBRh6kA"; // stRWT mint
const POOL = "WtXa3NyQaiYdD6hJrDGkHcYyMKv722LqmPXij8hh2BT"; // staking pool RWT vault
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const VA = 10000000, VS = 1000000; // virtual assets/shares (bootstrap rate = 10)

// Protocol-owned token accounts to exclude from holder counts (not real holders).
const EXCLUDE = new Set([
  "EYpKtcY5xkA8aQQTKYyEpFdRua5GM47YVWVfG9scn4Hd", // Omnipair market (pool reserves)
  "EwXST2yoQRBf3FEYe6fyoseatHaVypYck3ZQ5bEGzEUe", // staking pool (StakingConfig PDA)
]);

const BOOK = new URL("../book-nav/history.json", import.meta.url);
const STK = new URL("../strwt/history.json", import.meta.url);

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

// Unique owner addresses holding the mint (balance > 0), excluding protocol pools.
async function owners(mint) {
  try {
    const accs = await rpc("getProgramAccounts", [
      TOKEN_PROGRAM,
      { encoding: "jsonParsed", filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }] },
    ]);
    const set = new Set();
    for (const a of accs) {
      const info = a.account.data.parsed.info;
      if (Number(info.tokenAmount.amount) > 0 && !EXCLUDE.has(info.owner)) set.add(info.owner);
    }
    return set;
  } catch (e) {
    console.warn("holders lookup failed for", mint, e.message);
    return null;
  }
}

function appendPoint(file, point) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.points = data.points || [];
  const last = data.points[data.points.length - 1];
  if (last && last.t === point.t) data.points[data.points.length - 1] = point;
  else data.points.push(point);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  console.log(file.pathname.split("/").slice(-2).join("/"), JSON.stringify(point));
}

// Annualized growth (%) of `field` from the first to the last dated point.
function annualizedApy(points, field) {
  const pts = points.filter((p) => typeof p[field] === "number" && p.t);
  if (pts.length < 2) return null;
  const f = pts[0], l = pts[pts.length - 1];
  const days = (Date.parse(l.t) - Date.parse(f.t)) / 86400000;
  if (days <= 0 || f[field] <= 0) return null;
  return (Math.pow(l[field] / f[field], 365 / days) - 1) * 100;
}

// APY of `field` including the new point (projected onto the existing series).
function projectedApy(file, field, point) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const pts = (data.points || []).filter((p) => p.t !== point.t).concat([point]);
  return annualizedApy(pts, field);
}

async function main() {
  const t = new Date().toISOString().slice(0, 10);

  // ---- Book NAV ----
  const earnAcc = await rpc("getAccountInfo", [EARN, { encoding: "base64" }]);
  const bin = Buffer.from(earnAcc.value.data[0], "base64");
  let capital = 0n; // total_invested_capital: u128 LE at offset 8
  for (let i = 0; i < 16; i++) capital += BigInt(bin[8 + i]) << (8n * BigInt(i));
  const rwtSup = BigInt((await rpc("getTokenSupply", [RWT])).value.amount);
  const nav = rwtSup === 0n ? 1 : Number((capital * 1000000n) / rwtSup) / 1e6;
  // Holder sets (unique owners, protocol pools excluded)
  const rwtOwners = await owners(RWT);
  const stOwners = await owners(STRWT);
  const uniqueHolders = rwtOwners && stOwners ? new Set([...rwtOwners, ...stOwners]).size : null;

  const bookPoint = {
    t,
    nav: Number(nav.toFixed(6)),
    capital: Math.round(Number(capital) / 1e6),
    supply: Math.round(Number(rwtSup) / 1e6),
  };
  if (rwtOwners) bookPoint.holders = rwtOwners.size;
  if (uniqueHolders !== null) bookPoint.holders_unique = uniqueHolders;
  const bookApy = projectedApy(BOOK, "nav", bookPoint); // RWT APY from Book NAV growth
  if (bookApy !== null) bookPoint.apy = Number(bookApy.toFixed(2));
  appendPoint(BOOK, bookPoint);

  // ---- stRWT exchange rate ----
  const strwtSupply = Number((await rpc("getTokenSupply", [STRWT])).value.amount);
  const poolAcc = await rpc("getAccountInfo", [POOL, { encoding: "jsonParsed" }]);
  const poolRaw = Number(poolAcc.value.data.parsed.info.tokenAmount.amount);
  const rate = (poolRaw + VA) / (strwtSupply + VS); // RWT per stRWT
  const price = rate * nav; // USD per stRWT
  const stPoint = {
    t,
    rate: Number(rate.toFixed(6)),
    staked: Math.round(poolRaw / 1e6),       // RWT locked in the staking pool
    supply: Math.round(strwtSupply / 1e6),   // stRWT in circulation
    price: Number(price.toFixed(4)),
  };
  if (stOwners) stPoint.holders = stOwners.size;
  // stRWT APY in USD: price = rate × Book NAV, so it captures both the rising
  // exchange rate and the appreciation of the underlying RWT.
  const stApy = projectedApy(STK, "price", stPoint);
  if (stApy !== null) stPoint.apy = Number(stApy.toFixed(2));
  appendPoint(STK, stPoint);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
