// src/checker.js
const fetch = require("node-fetch");
const puppeteer = require("puppeteer-core");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";
const SEARCH_URL = "https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&classNbr=64766&honors=F&promod=F&searchType=all&term=2281";

let cachedToken = null;
let cachedCookies = null;
let tokenExpiry = 0;

async function refreshSession() {
  const browserlessToken = process.env.BROWSERLESS_TOKEN || "";

  console.log("[Checker] Refreshing session via /chromium/unblock...");
  const unblockRes = await fetch(
    `https://production-sfo.browserless.io/chromium/unblock?token=${browserlessToken}&proxy=residential&proxySticky=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: SEARCH_URL,
        browserWSEndpoint: true,
        cookies: true,
        content: false,
        screenshot: false,
        ttl: 60000
      }),
      timeout: 60000
    }
  );

  if (!unblockRes.ok) {
    throw new Error(`Unblock failed: ${unblockRes.status}`);
  }

  const unblockData = await unblockRes.json();
  const { browserWSEndpoint, cookies } = unblockData;

  // Connect and capture the Bearer token
  const browser = await puppeteer.connect({
    browserWSEndpoint: `${browserWSEndpoint}?token=${browserlessToken}`
  });

  try {
    const page = await browser.newPage();
    let capturedToken = null;

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const auth = req.headers()["authorization"];
      if (auth && auth.startsWith("Bearer ") && !capturedToken) {
        capturedToken = auth.replace("Bearer ", "").trim();
      }
      const type = req.resourceType();
      if (["image", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(SEARCH_URL, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    await page.close();

    console.log(`[Checker] Token: ${!!capturedToken}, Cookies: ${cookies?.length}`);

    if (capturedToken) {
      cachedToken = capturedToken;
      cachedCookies = cookies;
      tokenExpiry = Date.now() + 9 * 60 * 1000;
    }

    return capturedToken;
  } finally {
    await browser.disconnect();
  }
}

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  try {
    // Refresh session if needed
    if (!cachedToken || Date.now() > tokenExpiry) {
      await refreshSession();
    }

    if (!cachedToken) {
      console.log("[Checker] No token available");
      return { found: false };
    }

    // Build cookie string from unblocked session cookies
    const cookieStr = cachedCookies
      ? cachedCookies.map(c => `${c.name}=${c.value}`).join("; ")
      : "";

    const params = new URLSearchParams({
      refine: "Y", term: String(term), classNbr: String(classNumber),
      campusOrOnlineSelection: "A", honors: "F", promod: "F",
      searchType: "all", pageNumber: "1", pageSize: "5"
    });

    const apiUrl = `${BASE}?${params}`;

    // Make direct fetch with token + cookies from unblocked session
    const res = await fetch(apiUrl, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Authorization": `Bearer ${cachedToken}`,
        "Origin": "https://catalog.apps.asu.edu",
        "Referer": "https://catalog.apps.asu.edu/",
        "Cookie": cookieStr,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site"
      },
      timeout: 30000
    });

    const text = await res.text();
    console.log(`[Checker] API: status=${res.status} len=${text.length}`);
    if (text.length > 0) console.log(`[Checker] Preview: ${text.substring(0, 300)}`);

    if (!text || text.length < 5) {
      cachedToken = null; // force refresh next time
      return { found: false };
    }

    const data = JSON.parse(text);
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

  } catch(e) {
    console.error(`[Checker] Error: ${e.message}`);
    cachedToken = null;
    return { found: false };
  }
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
