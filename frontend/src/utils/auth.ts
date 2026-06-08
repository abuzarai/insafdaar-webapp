export const isLoggedIn = () => {
  try {
    const t = localStorage.getItem("insafdaar_token");
    return !!t && t.length > 10; // basic check
  } catch {
    return false;
  }
};
