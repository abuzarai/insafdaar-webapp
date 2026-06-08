// // import React, { useState } from "react";
// // import Sidebar from "./Sidebar";
// // import CaseIntakeSection from "./CaseIntakeSection";
// // import CasePreparationSection from "./CasePreparationSection";
// // import CaseHearingSection from "./CaseHearingSection";
// // import CaseClosureSection from "./CaseClosureSection";
// // import AdvocateProfileSection from "./AdvocateProfileSection";
// // import CaseDiscussion from "./CaseDiscussion";
// // import CaseStagesTrackingSection from "./CaseStagesTrackingSection";

// // export default function DashboardLayout() {
// //   const [active, setActive] = useState("Case Intake");

// //   const renderSection = () => {
// //     switch (active) {
// //       case "Case Intake":
// //         return <CaseIntakeSection />;

// //       case "Case Discussion":
// //         return <CaseDiscussion />;

// //       case "Case Stages":
// //         return <CaseStagesTrackingSection />;

// //       case "Case Preparation":
// //         return <CasePreparationSection />;

// //       case "Case Hearing":
// //         return <CaseHearingSection />;

// //       case "Case Closure":
// //         return <CaseClosureSection />;

// //       case "Advocate Profile":
// //         return <AdvocateProfileSection />;

// //       default:
// //         return <CaseIntakeSection />;
// //     }
// //   };

// //   return (
// //     <div className="flex w-full h-screen overflow-hidden">
// //       <Sidebar active={active} setActive={setActive} />
// //       <main className="flex-1 overflow-y-auto bg-white text-gray-800 p-10">
// //         {renderSection()}
// //       </main>
// //     </div>
// //   );
// // }




// import React, { useState } from "react";
// import Sidebar from "./Sidebar";
// import CaseIntakeSection from "./CaseIntakeSection";
// import CasePreparationSection from "./CasePreparationSection";
// import CaseHearingSection from "./CaseHearingSection";
// import CaseClosureSection from "./CaseClosureSection";
// import AdvocateProfileSection from "./AdvocateProfileSection";
// import CaseDiscussion from "./CaseDiscussion";
// import CaseStagesTrackingSection from "./CaseStagesTrackingSection";

// // ✅ add this import
// import AdvocateNotifications from "./AdvocateNotifications";

// export default function DashboardLayout() {
//   const [active, setActive] = useState("Case Intake");

//   const renderSection = () => {
//     switch (active) {
//       case "Case Intake":
//         return <CaseIntakeSection />;

//       case "Notifications":
//         return <AdvocateNotifications />;

//       case "Case Discussion":
//         return <CaseDiscussion />;

//       case "Case Stages":
//         return <CaseStagesTrackingSection />;

//       case "Case Preparation":
//         return <CasePreparationSection />;

//       case "Case Hearing":
//         return <CaseHearingSection />;

//       case "Case Closure":
//         return <CaseClosureSection />;

//       case "Advocate Profile":
//         return <AdvocateProfileSection />;

//       default:
//         return <CaseIntakeSection />;
//     }
//   };

//   return (
//     <div className="flex w-full h-screen overflow-hidden">
//       <Sidebar active={active} setActive={setActive} />
//       <main className="flex-1 overflow-y-auto bg-white text-gray-800 p-10">
//         {renderSection()}
//       </main>
//     </div>
//   );
// }

// DashboardLayout.tsx
import React, { useState } from "react";
import Sidebar from "./Sidebar";
import CaseIntakeSection from "./CaseIntakeSection";
import CasePreparationSection from "./CasePreparationSection";
import CaseHearingSection from "./CaseHearingSection";
import CaseClosureSection from "./CaseClosureSection";
import AdvocateProfileSection from "./AdvocateProfileSection";
import CaseDiscussion from "./CaseDiscussion";
import CaseStagesTrackingSection from "./CaseStagesTrackingSection";
import AdvocateNotifications from "./AdvocateNotifications";
import ContractSection from "./ContractSection";
import VoucherSection from "./VoucherSection";
import { useNavigate } from "react-router-dom";
import { Home, Bot, RefreshCw, LogOut } from "lucide-react";

export default function DashboardLayout() {
  const navigate = useNavigate();
  const [active, setActive] = useState("Case Intake");
  const [topRefreshing, setTopRefreshing] = useState(false);

  const renderSection = () => {
    switch (active) {
      case "Case Intake":
        return <CaseIntakeSection />;

      case "Case Discussion":
        return <CaseDiscussion />;

      case "Case Preparation":
        return <CasePreparationSection />;

      case "Case Hearing":
        return <CaseHearingSection />;

      // ✅ FIXED: must match sidebar name exactly
      case "Stages Tracking":
        return <CaseStagesTrackingSection />;

      case "Notifications":
        return <AdvocateNotifications />;

      case "Case Closure":
        return <CaseClosureSection />;

      case "Contract":
        return <ContractSection />;

      case "Vouchers":
        return <VoucherSection />;

      case "Advocate Profile":
        return <AdvocateProfileSection />;

      default:
        return <CaseIntakeSection />;
    }
  };

  const refreshTop = async () => {
    setTopRefreshing(true);
    setTimeout(() => setTopRefreshing(false), 350);
  };

  const doLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("role");
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex w-full min-h-screen bg-[#f9fafb] text-[#00142e]">
      <Sidebar active={active} setActive={setActive} />

      <div className="flex-1 flex flex-col w-full min-w-0">
        <header className="sticky top-0 z-20 w-full bg-white/95 backdrop-blur border-b border-slate-200 px-4 md:px-6 py-3 md:py-4">
          <div className="w-full flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-[#004aad] tracking-tight">Advocate Dashboard</h1>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition"
                title="Go to Home"
              >
                <Home size={18} className="text-slate-700" />
              </button>

              <button
                type="button"
                onClick={() => navigate("/legal-assistant")}
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition"
                title="Open Legal Assistant"
              >
                <Bot size={18} className="text-slate-700" />
              </button>

              <button
                type="button"
                onClick={refreshTop}
                disabled={topRefreshing}
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 transition disabled:opacity-60"
                title="Refresh"
              >
                <RefreshCw size={18} className={topRefreshing ? "animate-spin" : ""} style={{ color: "#1E3A8A" }} />
              </button>

              <button
                type="button"
                onClick={doLogout}
                className="inline-flex items-center justify-center rounded-xl px-3 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 transition"
                title="Logout"
              >
                <LogOut size={18} className="text-rose-800" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{renderSection()}</main>
      </div>
    </div>
  );
}
