/** Fixed deployment origin, independent of the proxy's internal request URL. */
export function valueLogOrigin() {
  const canonical = "https://valuelog.theinternetofvalue.org";
  const url = new URL(process.env.NEXT_PUBLIC_APP_URL || canonical);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || url.origin !== canonical && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("APP_ORIGIN_UNAVAILABLE");
  return url.origin;
}
