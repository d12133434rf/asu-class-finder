// src/checker.js
const puppeteer = require("puppeteer-core");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";
const SEARCH_URL = "https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&classNbr=64766&honors=F&promod=F&searchType=all&term=2281";

async function connectBrowser() {
  const token = process.env.BROWSERLESS_TOKEN || "";
  return await puppeteer.connect({
    browserWSEndpoint: `wss://production-sfo.browserless.io?token=${token}&stealth=true`,
  });
}

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  let browser = null;
  try {
    browser = await connectBrowser();
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

    // Load page to get token
    await page.goto(SEARCH_URL, { waitUntil: "networkidle0", timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));

    console.log(`[Checker] Token captured: ${!!capturedToken}`);

    if (!capturedToken) {
      await page.close();
      return { found: false };
    }

    // Make API call FROM THE SAME PAGE (don't close it yet)
    const params = new URLSearchParams({
      refine: "Y", term: String(term), classNbr: String(classNumber),
      campusOrOnlineSelection: "A", honors: "F", promod: "F",
      searchType: "all", pageNumber: "1", pageSize: "5"
    });
    const apiUrl = `${BASE}?${params}`;

    const result = await page.evaluate(async (url, token) => {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Accept": "application/json, text/plain, */*",
            "Authorization": `Bearer ${token}`,
            "Origin": "https://catalog.apps.asu.edu",
            "Referer": "https://catalog.apps.asu.edu/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });
        const text = await res.text();
        return { status: res.status, body: text, ok: res.ok };
      } catch(e) {
        return { error: e.message, status: 0, body: "" };
      }
    }, apiUrl, capturedToken);

    await page.close();

    console.log(`[Checker] API: status=${result.status} len=${result.body?.length} error=${result.error || "none"}`);
    if (result.body) console.log(`[Checker] Body preview: ${result.body.substring(0, 300)}`);

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

  } catch(e) {
    console.error(`[Checker] Error: ${e.message}`);
    return { found: false };
  } finally {
    if (browser) await browser.disconnect();
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
