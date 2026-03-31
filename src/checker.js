// src/checker.js - Uses Puppeteer with system Chromium
const fetch = require("node-fetch");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  console.log("[Auth] Getting fresh token via Puppeteer...");

  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process"
    ]
  });

  const page = await browser.newPage();
  let token = null;

  await page.setRequestInterception(true);
  page.on("request", req => {
    const auth = req.headers()["authorization"];
    if (auth && auth.startsWith("Bearer ") && req.url().includes("eadvs-cscc-catalog-api")) {
      token = auth.replace("Bearer ", "");
      console.log("[Auth] ✅ Token captured!");
    }
    req.continue();
  });

  try {
    await page.goto("https://classSearch.asu.edu/?campusOrOnlineSelection=A&searchType=all&term=2281", {
      waitUntil: "networkidle0",
      timeout: 45000
    });
    await new Promise(r => setTimeout(r, 5000));
  } catch(e) {
    console.warn("[Auth] Page load error:", e.message);
  }

  await browser.close();

  if (!token) throw new Error("Could not capture token");

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

  if (res.status === 401) {
    cachedToken = null;
    tokenExpiry = 0;
    throw new Error("AUTH_REQUIRED");
  }
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