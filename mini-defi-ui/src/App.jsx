import { ConnectButton } from "@rainbow-me/rainbowkit";
import AppRoutes from "./Routes.jsx";

export default function App() {
  return (
    <div style={{ padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Mini DeFi</h2>
        <ConnectButton />
      </div>

      <div style={{ marginTop: 16 }}>
        <AppRoutes />
      </div>
    </div>
  );
}
