// src/checker.js
const puppeteer = require("puppeteer-core");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";
const LOGIN_URL = "https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&classNbr=64766&honors=F&promod=F&searchType=all&term=2281";

let cachedToken = null;
let tokenExpiry = 0;
let browserInstance = null;
let pageInstance = null;

async function connectBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  const token = process.env.BROWSERLESS_TOKEN || "";
  browserInstance = await puppeteer.connect({
    browserWSEndpoint: `wss://production-sfo.browserless.io?token=${token}&stealth=true`,
  });
  return browserInstance;
}

async function loginAndGetToken() {
  console.log("[Checker] Logging into ASU...");
  const browser = await connectBrowser();
  const page = await browser.newPage();

  try {
    await page.setRequestInterception(true);

    let capturedToken = null;
    let classData = null;

    page.on("request", (req) => {
      const auth = req.headers()["authorization"];
      if (auth && auth.startsWith("Bearer ") && !capturedToken) {
        capturedToken = auth.replace("Bearer ", "").trim();
        console.log("[Checker] Captured token from authenticated request");
      }
      const type = req.resourceType();
      if (["image", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.on("response", async (response) => {
      const rUrl = response.url();
      if (rUrl.includes("catalog-microservices") && rUrl.includes("classes")) {
        try {
          const text = await response.text();
          if (text && text.length > 10) {
            classData = JSON.parse(text);
            console.log(`[Checker] Got class data during login flow: ${classData?.classes?.length} classes`);
          }
        } catch(e) {}
      }
    });

    // Go to class search — this will redirect to ASU login
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const currentUrl = page.url();
    console.log(`[Checker] Current URL after initial load: ${currentUrl}`);

    // Check if we're on a login page
    if (currentUrl.includes("weblogin") || currentUrl.includes("shibboleth") || currentUrl.includes("login")) {
      console.log("[Checker] On login page, entering credentials...");

      const username = process.env.ASU_USERNAME || "";
      const password = process.env.ASU_PASSWORD || "";

      // Try common login field selectors
      await page.waitForSelector("input[type='text'], input[name='username'], input[id='username'], #username", { timeout: 10000 });
      await page.type("input[type='text'], input[name='username'], #username", username, { delay: 50 });
      await page.type("input[type='password'], input[name='password'], #password", password, { delay: 50 });

      // Click submit
      await page.click("input[type='submit'], button[type='submit'], .btn-submit").catch(() => {});
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 5000));

      console.log(`[Checker] After login URL: ${page.url()}`);
    } else {
      console.log("[Checker] Already authenticated or no login required");
    }

    // Wait for class data to load
    await new Promise(r => setTimeout(r, 5000));
    console.log(`[Checker] Token captured: ${!!capturedToken}, classData: ${!!classData}`);

    if (capturedToken) {
      cachedToken = capturedToken;
      tokenExpiry = Date.now() + 9 * 60 * 1000;
    }

    return { token: capturedToken, classData };

  } finally {
    await page.close().catch(() => {});
  }
}

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  try {
    // Get or refresh token
    if (!cachedToken || Date.now() > tokenExpiry) {
      const result = await loginAndGetToken();
      if (!result.token) {
        console.log("[Checker] Could not get token");
        return { found: false };
      }
    }

    // Make API call using cached token
    const params = new URLSearchParams({
      refine: "Y", term: String(term), classNbr: String(classNumber),
      campusOrOnlineSelection: "A", honors: "F", promod: "F",
      searchType: "all", pageNumber: "1", pageSize: "5"
    });
    const apiUrl = `${BASE}?${params}`;

    const browser = await connectBrowser();
    const page = await browser.newPage();

    const result = await page.evaluate(async (url, token) => {
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
    }, apiUrl, cachedToken);

    await page.close();

    console.log(`[Checker] API: status=${result.status} len=${result.body?.length}`);

    if (!result.body || result.body.length < 5) {
      // Token might be expired, clear it
      cachedToken = null;
      return { found: false };
    }

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
