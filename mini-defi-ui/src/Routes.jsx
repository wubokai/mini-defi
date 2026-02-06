import { Link, Route, Routes, Navigate } from "react-router-dom";
import Farm from "./Farm.jsx";
import Pool from "./Pool.jsx";

export default function AppRoutes() {
  return (
    <div>
      <nav style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <Link to="/pool">Pool</Link>
        <Link to="/farm">Farm</Link>
      </nav>

      <Routes>
        <Route path="/" element={<Navigate to="/pool" replace />} />
        <Route path="/pool" element={<Pool />} />
        <Route path="/farm" element={<Farm />} />
      </Routes>
    </div>
  );
}
