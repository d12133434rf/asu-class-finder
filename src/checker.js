// src/checker.js
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";
const TOKEN_URL = "https://weblogin.asu.edu/serviceauth/oauth2/native/token";

let cachedToken = null;
let tokenExpiry = 0;

function getProxyAgent() {
  const proxyHost = process.env.PROXY_HOST || "gw.dataimpulse.com";
  const proxyPort = process.env.PROXY_PORT || "823";
  const proxyUser = process.env.PROXY_USER || "";
  const proxyPass = process.env.PROXY_PASS || "";
  return new HttpsProxyAgent(`http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`);
}

async function getToken() {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  console.log("[Checker] Fetching fresh ASU token...");
  const agent = getProxyAgent();

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: "catalog-class-search-app",
    client_secret: "serviceauth-public-agent"
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    agent,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    body: body.toString(),
    timeout: 15000
  });

  console.log(`[Checker] Token response: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    console.error("[Checker] Token error body:", text);
    throw new Error(`TOKEN_FETCH_FAILED_${res.status}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // expires_in is in seconds
  tokenExpiry = Date.now() + (data.expires_in || 600) * 1000;
  console.log(`[Checker] Got token, expires in ${data.expires_in}s`);
  return cachedToken;
}

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);
  const params = new URLSearchParams({
    refine: "Y", term: String(term), classNbr: String(classNumber),
    campusOrOnlineSelection: "A", honors: "F", promod: "F",
    searchType: "all", pageNumber: "1", pageSize: "5"
  });
  const targetUrl = `${BASE}?${params}`;
  const agent = getProxyAgent();

  let token;
  try {
    token = await getToken();
  } catch(e) {
    console.error("[Checker] Could not get token:", e.message);
    throw new Error("TOKEN_UNAVAILABLE");
  }

  const res = await fetch(targetUrl, {
    agent,
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Authorization": `Bearer ${token}`,
      "Origin": "https://classSearch.asu.edu",
      "Referer": "https://classSearch.asu.edu/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    timeout: 30000
  });

  console.log(`[Checker] Response: ${res.status}`);

  // If 401, clear cached token and retry once with fresh token
  if (res.status === 401) {
    console.log("[Checker] Got 401, clearing token cache and retrying...");
    cachedToken = null;
    tokenExpiry = 0;
    throw new Error("AUTH_REQUIRED");
  }

  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const data = await res.json();
  const classes = data?.classes ?? [];
  console.log(`[Checker] Classes found: ${classes.length}`);
  if (!classes.length) return { found: false };

  const match = classes[0];
  const enrollTotal = parseInt(match.ENRL_TOT ?? "0", 10);
  const enrollCap   = parseInt(match.ENRL_CAP ?? "0", 10);
  const classStatus = match.CLASS_STAT ?? "";
  const title       = match.COURSE_TITLE ?? "";
  const isOpen      = enrollTotal < enrollCap && classStatus === "A";

  console.log(`[Checker] ${classNumber}: ${enrollTotal}/${enrollCap} status=${classStatus} open=${isOpen}`);
  return { found: true, isOpen, enrollTotal, enrollCap, title };
}

async function fetchTerms() {
  return [
    { code: "2261", label: "Fall 2025" },
    { code: "2271", label: "Spring 2026" },
    { code: "2277", label: "Summer 2026" },
    { code: "2281", label: "Fall 2026" }
  ];
}

module.exports = { checkClass, fetchTerms };
