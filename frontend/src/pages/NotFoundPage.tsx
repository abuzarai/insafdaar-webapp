import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#00244d] to-[#004aad] text-white">
      <h1 className="text-7xl font-extrabold mb-4">404</h1>
      <h2 className="text-3xl font-bold mb-2">Page Not Found</h2>
      <p className="text-gray-200 mb-6 text-center max-w-md">
        The page you’re looking for doesn’t exist or may have been moved.
      </p>
      <Link
        to="/"
        className="px-6 py-3 bg-[#f5b301] text-[#002b5b] rounded-xl font-semibold shadow-lg hover:bg-[#ffd84d] transition"
      >
        Go Back Home
      </Link>
    </div>
  );
}
