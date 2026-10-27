// src/routes/RequireAuth.tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { dashboardForRole, getSessionRole } from "../utils/auth";
import { isVoiceEntry, withVoiceIntent } from "../utils/voiceEntry";

export default function RequireAuth({ roles }: { roles?: string[] }) {
  const role = getSessionRole();
  const location = useLocation();

  if (!role) {
    return <Navigate to={withVoiceIntent("/login", isVoiceEntry(location.pathname, location.search))} replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(role)) {
    return <Navigate to={dashboardForRole(role)} replace />;
  }

  return <Outlet />;
}
