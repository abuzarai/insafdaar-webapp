import DashboardLayout from "../components/AdvocateDashboard/DashboardLayout";

export default function AdvocateDashboardPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#000e25] via-[#01214e] to-[#004aad] text-white">
      {/* Entire page = sidebar + content */}
      <div className="flex min-h-screen">
        {/* Sidebar + Dashboard Content */}
        <DashboardLayout />
      </div>

      {/* Footer */}
      {/* <footer className="relative bg-[#00142e]/80 border-t border-white/10 py-8 text-center text-sm text-gray-400 backdrop-blur-lg">
        <div className="max-w-4xl mx-auto">
          <p className="text-gray-400">
            © {new Date().getFullYear()}{" "}
            <span className="text-[#f5b301] font-semibold">Insafdaar</span> — Empowering Justice through AI & Ethics
          </p>
          <p className="mt-2 text-xs text-gray-500">
            All activities are monitored for performance and compliance under AI-assisted ethical standards.
          </p>
        </div>

        
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-[#f5b301] via-[#00d4ff] to-[#004aad]" />
      </footer> */}
    </div>
  );
}
