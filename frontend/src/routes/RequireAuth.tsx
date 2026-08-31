// src/routes/RequireAuth.tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";

function getAuth() {
  const token = localStorage.getItem("token");
  let role = "";
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    role = String(user?.role || "").toUpperCase();
  } catch {
    // malformed stored user; treat as logged out with no role
  }
  return { token, role };
}

export default function RequireAuth({ roles }: { roles?: string[] }) {
  const { token, role } = getAuth();
  const location = useLocation();

  if (!token || token.length < 10) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}