const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const resolveApiUrl = () => {
  const explicitApiUrl = import.meta.env.VITE_API_URL?.trim();

  if (explicitApiUrl) {
    return trimTrailingSlash(explicitApiUrl);
  }

  if (typeof window === "undefined") {
    return "http://localhost:4000";
  }

  return `${window.location.protocol}//${window.location.hostname}:4000`;
};

export const apiUrl = resolveApiUrl();
