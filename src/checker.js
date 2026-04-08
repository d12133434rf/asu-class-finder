// src/checker.js
const fetch = require("node-fetch");
const puppeteer = require("puppeteer-core");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";
const SEARCH_URL = "https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&classNbr=64766&honors=F&promod=F&searchType=all&term=2281";

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  const browserlessToken = process.env.BROWSERLESS_TOKEN || "";

  // Step 1: Use /chromium/unblock to get past bot detection and get a browserWSEndpoint
  console.log("[Checker] Calling /chromium/unblock...");
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
        ttl: 30000
      }),
      timeout: 60000
    }
  );

  console.log(`[Checker] Unblock status: ${unblockRes.status}`);
  if (!unblockRes.ok) {
    const text = await unblockRes.text();
    console.log(`[Checker] Unblock error: ${text.substring(0, 200)}`);
    return { found: false };
  }

  const unblockData = await unblockRes.json();
  console.log(`[Checker] Unblock keys: ${Object.keys(unblockData).join(", ")}`);

  const { browserWSEndpoint, cookies } = unblockData;
  if (!browserWSEndpoint) {
    console.log("[Checker] No browserWSEndpoint returned");
    return { found: false };
  }

  // Step 2: Connect to the unblocked browser and make the API call
  const browser = await puppeteer.connect({
    browserWSEndpoint: `${browserWSEndpoint}?token=${browserlessToken}`
  });

  try {
    const page = await browser.newPage();

    // Inject cookies from the unblocked session
    if (cookies && cookies.length > 0) {
      await page.setCookie(...cookies);
      console.log(`[Checker] Set ${cookies.length} cookies`);
    }

    // Capture Bearer token from requests
    let capturedToken = null;
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const auth = req.headers()["authorization"];
      if (auth && auth.startsWith("Bearer ") && !capturedToken) {
        capturedToken = auth.replace("Bearer ", "").trim();
        console.log("[Checker] Captured token!");
      }
      req.continue();
    });

    // Navigate to trigger token generation
    await page.goto(SEARCH_URL, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    console.log(`[Checker] Token captured: ${!!capturedToken}`);

    if (!capturedToken) {
      await page.close();
      return { found: false };
    }

    // Make API call from within the page
    const params = new URLSearchParams({
      refine: "Y", term: String(term), classNbr: String(classNumber),
      campusOrOnlineSelection: "A", honors: "F", promod: "F",
      searchType: "all", pageNumber: "1", pageSize: "5"
    });

    const result = await page.evaluate(async (url, token) => {
      try {
        const res = await fetch(url, {
          headers: {
            "Accept": "application/json, text/plain, */*",
            "Authorization": `Bearer ${token}`,
            "Origin": "https://catalog.apps.asu.edu",
            "Referer": "https://catalog.apps.asu.edu/",
          }
        });
        const text = await res.text();
        return { status: res.status, body: text };
      } catch(e) {
        return { error: e.message, status: 0, body: "" };
      }
    }, `${BASE}?${params}`, capturedToken);

    await page.close();

    console.log(`[Checker] API: status=${result.status} len=${result.body?.length}`);
    if (result.body?.length > 0) console.log(`[Checker] Preview: ${result.body.substring(0, 200)}`);

    if (!result.body || result.body.length < 5) return { found: false };

    const data = JSON.parse(result.body);
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

  } finally {
    await browser.disconnect();
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
