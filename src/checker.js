// src/checker.js
const puppeteer = require("puppeteer-core");

const BASE = "https://catalog.apps.asu.edu/catalog/classes/classlist";
const TOKEN_ENDPOINT = "https://weblogin.asu.edu/serviceauth/oauth2/native/token";

let cachedToken = null;
let tokenExpiry = 0;

async function connectBrowser() {
  const token = process.env.BROWSERLESS_TOKEN || "";
  return await puppeteer.connect({
    browserWSEndpoint: `wss://production-sfo.browserless.io?token=${token}&stealth=true`,
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  console.log("[Checker] Getting fresh token via browser...");
  let browser = null;
  try {
    browser = await connectBrowser();
    const page = await browser.newPage();

    let capturedToken = null;

    // Intercept requests to capture the Bearer token
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const auth = req.headers()["authorization"];
      if (auth && auth.startsWith("Bearer ") && !capturedToken) {
        capturedToken = auth.replace("Bearer ", "").trim();
        console.log("[Checker] Captured Bearer token from browser request");
      }
      req.continue();
    });

    // Visit ASU class search — the page will auto-authenticate and make API calls
    await page.goto(`${BASE}?campusOrOnlineSelection=A&classNbr=64766&honors=F&promod=F&searchType=all&term=2281`, {
      waitUntil: "networkidle0",
      timeout: 45000
    });
    await new Promise(r => setTimeout(r, 5000));

    await page.close();

    if (capturedToken) {
      cachedToken = capturedToken;
      tokenExpiry = Date.now() + 9 * 60 * 1000;
      console.log("[Checker] Token cached successfully");
      return cachedToken;
    }

    throw new Error("Could not capture token from browser");
  } finally {
    if (browser) await browser.disconnect();
  }
}

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  let browser = null;
  try {
    browser = await connectBrowser();
    const page = await browser.newPage();

    await page.setRequestInterception(true);

    let classData = null;
    let capturedToken = null;

    page.on("request", (req) => {
      const auth = req.headers()["authorization"];
      if (auth && auth.startsWith("Bearer ") && !capturedToken) {
        capturedToken = auth.replace("Bearer ", "").trim();
        console.log("[Checker] Captured token from request");
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
          const json = await response.json();
          if (json && json.classes !== undefined) {
            classData = json;
            console.log(`[Checker] Got API data: ${json.classes.length} classes`);
          }
        } catch(e) {
          console.log(`[Checker] API response parse error: ${e.message}`);
        }
      }
      // Also log token endpoint responses
      if (rUrl.includes("serviceauth") && rUrl.includes("token")) {
        try {
          const json = await response.json();
          if (json.access_token) {
            cachedToken = json.access_token;
            tokenExpiry = Date.now() + (json.expires_in || 600) * 1000;
            console.log("[Checker] Captured token from token endpoint");
          }
        } catch(e) {}
      }
    });

    const url = `${BASE}?campusOrOnlineSelection=A&classNbr=${classNumber}&honors=F&promod=F&searchType=all&term=${term}`;
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 });
    await new Promise(r => setTimeout(r, 5000));

    // Log what network requests were made
    console.log(`[Checker] classData=${!!classData} capturedToken=${!!capturedToken}`);

    await page.close();

    if (!classData) {
      console.log(`[Checker] No API data for ${classNumber}`);
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
