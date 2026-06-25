// Daily snapshots → book-nav/history.json and strwt/history.json
// Runs server-side (GitHub Actions), so it may use RPC methods browsers can't
// (getProgramAccounts for holder counts, api.mainnet-beta, etc.).
import { readFileSync, writeFileSync } from "node:fs";

const RPC = process.env.RPC || "https://api.mainnet-beta.solana.com";
const EARN = "5GyVeryGnTPPtfteYaj5pNUjE9s2DDDpDnccgoFjV8L3"; // EarnConfig PDA
const RWT = "RWTeFt9M635Tf6w6yveAoXQR2ZwfXs7MfA7W3grDuGT"; // RWT mint
const STRWT = "sRWTy1bkqvRegb31RETanhbAtJ7eXN6XsTvaqBRh6kA"; // stRWT mint
const STAKING_CONFIG = "EwXST2yoQRBf3FEYe6fyoseatHaVypYck3ZQ5bEGzEUe"; // StakingConfig PDA
const ARL = "6JSXRGMH6wNiukuLi4x6rSHazJMQL51WGbzirXxsmeta"; // ARL governance token mint
const ARL_GENESIS = 25800000; // ARL genesis supply; burned = genesis - circulating
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const VA = 10000000, VS = 1000000; // virtual assets/shares (bootstrap rate = 10)
const ACTIVE_OFFSET = 201; // total_rwt_active (u64 LE) within StakingConfig data — rate numerator

// Protocol-owned token accounts to exclude from holder counts (not real holders).
const EXCLUDE = new Set([
  "EYpKtcY5xkA8aQQTKYyEpFdRua5GM47YVWVfG9scn4Hd", // Omnipair market (pool reserves)
  "EwXST2yoQRBf3FEYe6fyoseatHaVypYck3ZQ5bEGzEUe", // staking pool (StakingConfig PDA)
  "E45yD8h2ZsJdHFMPdowKvrC6gS9BgrcansUwHDEDokiF", // DAO treasury multisig vault
  "5BhKSFDV3mNzUxCaAyMZtbakhkbApwzLBD4gnQmNoz3Z", // futarchy launch PDA / pool
  "H24aevTrQjbeAEHbzvDa4yhovsoZUc4FTndtk6sspn7m", // Meteora ARL/USDC pool
]);

const BOOK = new URL("../book-nav/history.json", import.meta.url);
const STK = new URL("../strwt/history.json", import.meta.url);
const ARLF = new URL("../arl/history.json", import.meta.url);

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

// ARL price (USD) from DexScreener — most-liquid pair.
async function arlPrice() {
  try {
    const d = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + ARL).then((r) => r.json());
    const pairs = (d.pairs || []).slice().sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0));
    return pairs.length ? Number(pairs[0].priceUsd) : null;
  } catch (e) {
    console.warn("ARL price lookup failed:", e.message);
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
  // Rate numerator is the on-chain counter `total_rwt_active`, NOT the vault
  // balance: the vault also holds `total_rwt_reserved` (RWT locked in unstake
  // cooldown after the stRWT was burned). Using the vault would inflate the rate.
  const strwtSupply = Number((await rpc("getTokenSupply", [STRWT])).value.amount);
  const cfgAcc = await rpc("getAccountInfo", [STAKING_CONFIG, { encoding: "base64" }]);
  const cfgBin = Buffer.from(cfgAcc.value.data[0], "base64");
  const activeRwt = Number(cfgBin.readBigUInt64LE(ACTIVE_OFFSET)); // RWT actively staked
  const rate = (activeRwt + VA) / (strwtSupply + VS); // RWT per stRWT
  const price = rate * nav; // USD per stRWT
  const stPoint = {
    t,
    rate: Number(rate.toFixed(6)),
    staked: Math.round(activeRwt / 1e6),     // RWT actively staked (excludes cooldown)
    supply: Math.round(strwtSupply / 1e6),   // stRWT in circulation
    price: Number(price.toFixed(4)),
  };
  if (stOwners) stPoint.holders = stOwners.size;
  // stRWT APY in USD: price = rate × Book NAV, so it captures both the rising
  // exchange rate and the appreciation of the underlying RWT.
  const stApy = projectedApy(STK, "price", stPoint);
  if (stApy !== null) stPoint.apy = Number(stApy.toFixed(2));
  appendPoint(STK, stPoint);

  // ---- ARL governance token ----
  const arlSupplyRaw = (await rpc("getTokenSupply", [ARL])).value;
  const arlSupply = Number(arlSupplyRaw.uiAmount);
  const burned = Math.max(0, ARL_GENESIS - arlSupply);
  const price = await arlPrice();
  const arlOwners = await owners(ARL);
  const arlPoint = {
    t,
    supply: Number(arlSupply.toFixed(6)),
    burned: Number(burned.toFixed(6)),
  };
  if (price !== null) {
    arlPoint.price = Number(price.toFixed(8));
    arlPoint.mcap = Math.round(price * arlSupply);
  }
  if (arlOwners) arlPoint.holders = arlOwners.size;
  const arlApy = projectedApy(ARLF, "price", arlPoint);
  if (arlApy !== null) arlPoint.apy = Number(arlApy.toFixed(2));
  appendPoint(ARLF, arlPoint);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
