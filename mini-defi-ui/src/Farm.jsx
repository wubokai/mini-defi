import { useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";

import addresses from "./addresses.json";
import chefAbiJson from "./abi/MultiLPStaking.json";
import pairAbiJson from "./abi/Pair.json";
import rewardAbiJson from "./abi/RewardToken.json";

const chefAbi = chefAbiJson.abi;
const pairAbi = pairAbiJson.abi;
const rewardAbi = rewardAbiJson.abi;

function bnToFloatStr(x, decimals = 18, dp = 6) {
  if (!x) return "0";
  const s = formatUnits(x, decimals);
  const [a, b = ""] = s.split(".");
  return b.length ? `${a}.${b.slice(0, dp)}` : a;
}

export default function Farm() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const chef = addresses.chef.address;
  const pools = addresses.chef.pools;

  const [pid, setPid] = useState(0);
  const [amountStr, setAmountStr] = useState("");

  const selected = pools[pid];
  const lpToken = selected?.lpToken;
  const rewardToken = addresses.tokens.reward;

  // -------- Reads --------
  const poolInfo = useReadContract({
    address: chef,
    abi: chefAbi,
    functionName: "poolInfo",
    args: [BigInt(pid)],
    query: { enabled: !!chef },
  });

  const userInfo = useReadContract({
    address: chef,
    abi: chefAbi,
    functionName: "userInfo",
    args: [BigInt(pid), address],
    query: { enabled: !!chef && !!address },
  });

  const pending = useReadContract({
    address: chef,
    abi: chefAbi,
    functionName: "pendingRewards",
    args: [BigInt(pid), address],
    query: { enabled: !!chef && !!address, refetchInterval: 1500 },
  });

  const lpBal = useReadContract({
    address: lpToken,
    abi: pairAbi,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!lpToken && !!address, refetchInterval: 1500 },
  });

  const lpAllowance = useReadContract({
    address: lpToken,
    abi: pairAbi,
    functionName: "allowance",
    args: [address, chef],
    query: { enabled: !!lpToken && !!address && !!chef, refetchInterval: 1500 },
  });

  const rwdBal = useReadContract({
    address: rewardToken,
    abi: rewardAbi,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!rewardToken && !!address, refetchInterval: 1500 },
  });

  const decimals = 18; 

  const stakeAmount = useMemo(() => {
    try {
      if (!amountStr) return 0n;
      return parseUnits(amountStr, decimals);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  const allowanceEnough = useMemo(() => {
    const a = lpAllowance.data ?? 0n;
    return a >= stakeAmount && stakeAmount > 0n;
  }, [lpAllowance.data, stakeAmount]);

  // -------- Actions --------
  async function approve() {
    if (!isConnected) return alert("Connect wallet first");
    if (!lpToken) return;

    // approve a large amount for demo
    const max = (2n ** 256n) - 1n;
    await writeContractAsync({
      address: lpToken,
      abi: pairAbi,
      functionName: "approve",
      args: [chef, max],
    });
  }

  async function deposit() {
    if (!isConnected) return alert("Connect wallet first");
    if (stakeAmount <= 0n) return alert("Enter amount");
    await writeContractAsync({
      address: chef,
      abi: chefAbi,
      functionName: "deposit",
      args: [BigInt(pid), stakeAmount],
    });
  }

  async function harvest() {
    if (!isConnected) return alert("Connect wallet first");
    await writeContractAsync({
      address: chef,
      abi: chefAbi,
      functionName: "harvest",
      args: [BigInt(pid)],
    });
  }

  async function withdraw() {
    if (!isConnected) return alert("Connect wallet first");
    if (stakeAmount <= 0n) return alert("Enter amount");
    await writeContractAsync({
      address: chef,
      abi: chefAbi,
      functionName: "withdraw",
      args: [BigInt(pid), stakeAmount],
    });
  }

  // -------- UI --------
  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
      {/* Pool list */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Pools</h3>
        {pools.map((p, i) => (
          <button
            key={i}
            onClick={() => setPid(i)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: 10,
              borderRadius: 10,
              border: i === pid ? "2px solid #111" : "1px solid #ddd",
              background: i === pid ? "#f3f3f3" : "white",
              marginBottom: 8,
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700 }}>pid {p.pid}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>LP: {p.lpToken.slice(0, 10)}…</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>alloc: {p.allocPoint}</div>
          </button>
        ))}
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>
          chef: {chef.slice(0, 10)}…
        </div>
      </div>

      {/* Pool detail */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Pool #{pid} Detail</h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Card title="Your LP Balance" value={bnToFloatStr(lpBal.data, decimals)} />
          <Card title="Your Staked" value={bnToFloatStr(userInfo.data?.[0], decimals)} />
          <Card title="Pending RWD" value={bnToFloatStr(pending.data, decimals)} />
          <Card title="Your RWD Balance" value={bnToFloatStr(rwdBal.data, decimals)} />
          <Card title="Pool Total Staked" value={bnToFloatStr(poolInfo.data?.[4], decimals)} />
          <Card title="Reward / sec" value={bnToFloatStr(BigInt(addresses.chef.rewardPerSecond), decimals)} />
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="Amount"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", width: 220 }}
          />
          <button
            onClick={() => setAmountStr(bnToFloatStr(lpBal.data, decimals, 6))}
            style={btnStyle("white")}
          >
            Max LP
          </button>
          <button
            onClick={() => setAmountStr(bnToFloatStr(userInfo.data?.[0], decimals, 6))}
            style={btnStyle("white")}
          >
            Max Staked
          </button>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={approve} style={btnStyle()}>
            Approve LP
          </button>

          <button
            onClick={deposit}
            style={btnStyle(allowanceEnough ? "#111" : "#999")}
            disabled={!allowanceEnough}
            title={!allowanceEnough ? "Approve first (or amount=0)" : ""}
          >
            Deposit
          </button>

          <button onClick={harvest} style={btnStyle()}>
            Harvest
          </button>

          <button onClick={withdraw} style={btnStyle()}>
            Withdraw
          </button>
        </div>

       
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

function btnStyle(bg = "#111") {
  const isDark = bg !== "white";
  return {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #ddd",
    background: bg,
    color: isDark ? "white" : "#111",
    cursor: "pointer",
  };
}
