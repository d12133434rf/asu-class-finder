// src/checker.js
const fetch = require("node-fetch");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  console.log("[Auth] Launching Puppeteer...");

  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-extensions"
    ]
  });

  console.log("[Auth] Browser launched, opening page...");
  const page = await browser.newPage();
  let token = null;
  let requestCount = 0;

  await page.setRequestInterception(true);
  page.on("request", req => {
    requestCount++;
    const auth = req.headers()["authorization"];
    const url = req.url();
    if (url.includes("eadvs-cscc-catalog-api")) {
      console.log(`[Auth] API request detected: ${url.substring(0, 80)}`);
      console.log(`[Auth] Auth header: ${auth ? auth.substring(0, 40) : "NONE"}`);
      if (auth && auth.startsWith("Bearer ")) {
        token = auth.replace("Bearer ", "");
        console.log("[Auth] ✅ Token captured!");
      }
    }
    req.continue();
  });

  page.on("response", async res => {
    if (res.url().includes("eadvs-cscc-catalog-api")) {
      console.log(`[Auth] API response: ${res.status()} for ${res.url().substring(0, 80)}`);
    }
  });

  try {
    console.log("[Auth] Navigating to classSearch.asu.edu...");
    await page.goto("https://classSearch.asu.edu/?campusOrOnlineSelection=A&searchType=all&term=2281", {
      waitUntil: "networkidle0",
      timeout: 45000
    });
    console.log(`[Auth] Page loaded. Total requests intercepted: ${requestCount}`);
    console.log("[Auth] Page title:", await page.title());
    await new Promise(r => setTimeout(r, 5000));
    console.log(`[Auth] After wait. Token captured: ${token ? "YES" : "NO"}`);
  } catch(e) {
    console.error("[Auth] Navigation error:", e.message);
    console.log(`[Auth] Requests so far: ${requestCount}, token: ${token ? "YES" : "NO"}`);
  }

  await browser.close();
  console.log("[Auth] Browser closed.");

  if (!token) throw new Error("Could not capture token from ASU page");

  cachedToken = token;
  tokenExpiry = Date.now() + 50 * 60 * 1000;
  return token;
}

async function checkClass(classNumber, term) {
  const token = await getToken();

  const params = new URLSearchParams({
    refine: "Y", term: String(term), classNbr: String(classNumber),
    campusOrOnlineSelection: "A", honors: "F", promod: "F",
    searchType: "all", pageNumber: "1", pageSize: "5"
  });

  const res = await fetch(`${BASE}?${params}`, {
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
      "Origin": "https://classSearch.asu.edu",
      "Referer": "https://classSearch.asu.edu/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  console.log(`[Checker] Response: ${res.status}`);
  if (res.status === 401) { cachedToken = null; tokenExpiry = 0; throw new Error("AUTH_REQUIRED"); }
  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const data = await res.json();
  const classes = data?.classes ?? [];
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