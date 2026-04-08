// src/checker.js
const puppeteer = require("puppeteer-core");

const BASE = "https://catalog.apps.asu.edu/catalog/classes/classlist";
const TOKEN_URL = "https://weblogin.asu.edu/serviceauth/oauth2/native/token";

let browser = null;
let page = null; // reuse single page
let currentToken = null;
let tokenExpiry = 0;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  console.log("[Checker] Launching browser...");
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/chromium-browser",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--hide-scrollbars",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-first-run",
      "--safebrowsing-disable-auto-update",
    ],
  });
  console.log("[Checker] Browser launched");
  return browser;
}

async function getPage() {
  const b = await getBrowser();
  if (page && !page.isClosed()) return page;

  page = await b.newPage();

  // Intercept to capture Bearer token from any request
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const auth = req.headers()["authorization"];
    if (auth && auth.startsWith("Bearer ")) {
      const token = auth.replace("Bearer ", "").trim();
      if (token !== currentToken) {
        currentToken = token;
        tokenExpiry = Date.now() + 9 * 60 * 1000;
        console.log("[Checker] Captured fresh Bearer token from browser");
      }
    }
    const type = req.resourceType();
    if (["image", "font", "media"].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  // First visit to get Cloudflare clearance
  console.log("[Checker] Warming up browser session...");
  await page.goto("https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&classNbr=64766&honors=F&promod=F&searchType=all&term=2281", {
    waitUntil: "networkidle0",
    timeout: 45000
  });
  await new Promise(r => setTimeout(r, 5000));
  console.log(`[Checker] Warmup done, token captured: ${!!currentToken}`);

  return page;
}

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  const url = `${BASE}?campusOrOnlineSelection=A&classNbr=${classNumber}&honors=F&promod=F&searchType=all&term=${term}`;

  try {
    const p = await getPage();

    let classData = null;

    // Listen for API response
    const responseHandler = async (response) => {
      const rUrl = response.url();
      if (rUrl.includes("catalog-microservices") && rUrl.includes("classes")) {
        try {
          const json = await response.json();
          if (json && json.classes) {
            classData = json;
            console.log(`[Checker] Got API data: ${json.classes.length} classes`);
          }
        } catch(e) {}
      }
    };

    p.on("response", responseHandler);

    await p.goto(url, { waitUntil: "networkidle0", timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));

    p.off("response", responseHandler);

    if (!classData) {
      console.log(`[Checker] No API data for ${classNumber}, token=${!!currentToken}`);
      return { found: false };
    }

    const classes = classData.classes ?? [];
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
    // Reset page on error
    if (page && !page.isClosed()) await page.close().catch(() => {});
    page = null;
    throw e;
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
