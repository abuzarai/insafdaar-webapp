export const isLoggedIn = () => {
  try {
    const t = localStorage.getItem("token");
    return !!t && t.length > 10; // basic check
  } catch {
    return false;
  }
};
