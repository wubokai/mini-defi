import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";

import addresses from "./addresses.json";
import erc20AbiJson from "./abi/MockERC20.json";     // 如果你没这个，就用 Pair/RewardToken 的 ERC20 ABI（都带 approve/balanceOf）
import routerAbiJson from "./abi/Router.json";
import pairAbiJson from "./abi/Pair.json";

const erc20Abi = erc20AbiJson.abi;
const routerAbi = routerAbiJson.abi;
const pairAbi = pairAbiJson.abi;

const DECIMALS = 18;

function fmt(x) {
  return x ? formatUnits(x, DECIMALS) : "0";
}

export default function Pool() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const router = addresses.dex.router;
  const tokenA = addresses.tokens.tokenA;
  const tokenB = addresses.tokens.tokenB;
  const pair0 = addresses.dex.pair0;

  const [amtA, setAmtA] = useState("100");
  const [amtB, setAmtB] = useState("100");

  const a = useMemo(() => {
    try { return parseUnits(amtA || "0", DECIMALS); } catch { return 0n; }
  }, [amtA]);

  const b = useMemo(() => {
    try { return parseUnits(amtB || "0", DECIMALS); } catch { return 0n; }
  }, [amtB]);

  // balances
  const balA = useReadContract({
    address: tokenA,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address, refetchInterval: 1500 },
  });
  const balB = useReadContract({
    address: tokenB,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address, refetchInterval: 1500 },
  });

  // allowances
  const allowA = useReadContract({
    address: tokenA,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address, router],
    query: { enabled: !!address, refetchInterval: 1500 },
  });
  const allowB = useReadContract({
    address: tokenB,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address, router],
    query: { enabled: !!address, refetchInterval: 1500 },
  });

  // LP balance
  const lpBal = useReadContract({
    address: pair0,
    abi: pairAbi,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address, refetchInterval: 1500 },
  });

  const enoughA = (allowA.data ?? 0n) >= a && a > 0n;
  const enoughB = (allowB.data ?? 0n) >= b && b > 0n;

  async function approveA() {
    if (!isConnected) return alert("Connect wallet");
    const max = (2n ** 256n) - 1n;
    await writeContractAsync({ address: tokenA, abi: erc20Abi, functionName: "approve", args: [router, max] });
  }
  async function approveB() {
    if (!isConnected) return alert("Connect wallet");
    const max = (2n ** 256n) - 1n;
    await writeContractAsync({ address: tokenB, abi: erc20Abi, functionName: "approve", args: [router, max] });
  }

  async function addLiquidity() {
    if (!isConnected) return alert("Connect wallet");
    if (a <= 0n || b <= 0n) return alert("Enter amounts");

    // 你的 Router 签名是：
    // addLiquidity(address tokenA, address tokenB, uint amountA, uint amountB, uint minA, uint minB, address to)
    await writeContractAsync({
      address: router,
      abi: routerAbi,
      functionName: "addLiquidity",
      args: [tokenA, tokenB, a, b, 0n, 0n, address],
    });
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Pool — Add Liquidity (A/B)</h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Card title="TokenA Balance" value={fmt(balA.data)} />
        <Card title="TokenB Balance" value={fmt(balB.data)} />
        <Card title="Your LP (pair0)" value={fmt(lpBal.data)} />
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input value={amtA} onChange={(e) => setAmtA(e.target.value)} placeholder="TokenA amount"
          style={inputStyle} />
        <button onClick={() => setAmtA(fmt(balA.data).slice(0, 10))} style={btn("white")}>Max A</button>
        <button onClick={approveA} style={btn()}>Approve A</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{enoughA ? "✅ allowance ok" : "⚠️ need approve"}</span>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input value={amtB} onChange={(e) => setAmtB(e.target.value)} placeholder="TokenB amount"
          style={inputStyle} />
        <button onClick={() => setAmtB(fmt(balB.data).slice(0, 10))} style={btn("white")}>Max B</button>
        <button onClick={approveB} style={btn()}>Approve B</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{enoughB ? "✅ allowance ok" : "⚠️ need approve"}</span>
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          onClick={addLiquidity}
          style={btn(enoughA && enoughB ? "#111" : "#999")}
          disabled={!(enoughA && enoughB)}
        >
          Add Liquidity
        </button>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
        成功后你会获得 LP（pair0），然后去 Farm 页面 Approve LP → Deposit。
      </div>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const inputStyle = { padding: 10, borderRadius: 10, border: "1px solid #ddd", width: 220 };

function btn(bg = "#111") {
  const dark = bg !== "white";
  return {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: bg,
    color: dark ? "white" : "#111",
    cursor: "pointer",
  };
}
