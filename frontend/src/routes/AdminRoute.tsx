// src/routes/AdminRoute.tsx
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

function getAuth() {
  const token = localStorage.getItem("token");
  const role = String(localStorage.getItem("role") || "").toUpperCase();
  return { token, role };
}

export default function AdminRoute() {
  const { token, role } = getAuth();
  const location = useLocation();

  // not logged in
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // logged in but not admin
  if (role !== "ADMIN") {
    return <Navigate to="/" replace />;
    // you can change to: "/unauthorized" if you create that page
  }

  return <Outlet />;
}
