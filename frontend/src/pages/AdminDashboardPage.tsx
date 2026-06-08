import React from "react";
import AdminDashboard from "../components/AdminDashboard/AdminDashboard";

export default function AdminDashboardPage() {
  return (
    <div className="min-h-screen bg-[#f9fafb] text-[#00142e]">
      <div className="w-full p-4 md:p-6">
        <AdminDashboard />
      </div>
    </div>
  );
}
