import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "viem";

const hardhatLocal = {
  id: 31337,
  name: "Hardhat 31337",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
    public: { http: ["http://127.0.0.1:8545"] },
  },
};

export const config = getDefaultConfig({
  appName: "Mini DeFi",
  projectId: "mini-defi-local",
  chains: [hardhatLocal],
  transports: {
    [hardhatLocal.id]: http("http://127.0.0.1:8545"),
  },
});
