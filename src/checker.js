// src/checker.js
const fetch = require("node-fetch");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";
const TOKEN_URL = "https://weblogin.asu.edu/serviceauth/oauth2/native/token";

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  console.log("[Checker] Refreshing ASU token...");
  const refreshToken = process.env.ASU_REFRESH_TOKEN || "";

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: "catalog-class-search-app",
    client_secret: "serviceauth-public-agent"
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    body: body.toString(),
    timeout: 15000
  });

  console.log(`[Checker] Token refresh response: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    console.error("[Checker] Token refresh error:", text);
    throw new Error(`TOKEN_REFRESH_FAILED_${res.status}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Update refresh token if a new one is returned
  if (data.refresh_token) {
    process.env.ASU_REFRESH_TOKEN = data.refresh_token;
    console.log("[Checker] Got new refresh token");
  }
  tokenExpiry = Date.now() + (data.expires_in || 600) * 1000;
  console.log(`[Checker] Token refreshed, expires in ${data.expires_in}s`);
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
  const cookie = process.env.ASU_COOKIE || "";

  let token;
  try {
    token = await getToken();
  } catch(e) {
    console.error("[Checker] Could not get token:", e.message);
    throw new Error("TOKEN_UNAVAILABLE");
  }

  const res = await fetch(targetUrl, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Authorization": `Bearer ${token}`,
      "Origin": "https://catalog.apps.asu.edu",
      "Referer": "https://catalog.apps.asu.edu/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Cookie": cookie
    },
    timeout: 30000
  });

  console.log(`[Checker] Response: ${res.status}`);
  const text = await res.text();

  if (res.status === 401 || res.status === 403) {
    cachedToken = null;
    tokenExpiry = 0;
    throw new Error("AUTH_REQUIRED");
  }
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  if (!text || text.trim() === "") throw new Error("EMPTY_RESPONSE");

  const data = JSON.parse(text);
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
