// src/checker.js
const puppeteer = require("puppeteer-core");

const PAGE_URL = "https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&classNbr=64766&honors=F&promod=F&searchType=all&term=2281";
const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";

async function connectBrowser() {
  const token = process.env.BROWSERLESS_TOKEN || "";
  // Use residential proxy + stealth mode
  return await puppeteer.connect({
    browserWSEndpoint: `wss://production-sfo.browserless.io?token=${token}&stealth=true&proxy=residential`,
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

    // Also try to intercept the actual API response directly
    let classData = null;
    page.on("response", async (response) => {
      const rUrl = response.url();
      if (rUrl.includes("catalog-microservices") && rUrl.includes("classes")) {
        try {
          const text = await response.text();
          console.log(`[Checker] Intercepted API: status=${response.status()} len=${text.length}`);
          if (text && text.length > 10) {
            classData = JSON.parse(text);
          }
        } catch(e) {}
      }
    });

    await page.goto(PAGE_URL, { waitUntil: "networkidle0", timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    console.log(`[Checker] Token=${!!capturedToken} classData=${!!classData}`);

    // If we got class data from interception, use it directly for this class
    if (classData && classData.classes) {
      console.log(`[Checker] Using intercepted data`);
    }

    // Make direct API call from within browser using captured token
    if (capturedToken) {
      const params = new URLSearchParams({
        refine: "Y", term: String(term), classNbr: String(classNumber),
        campusOrOnlineSelection: "A", honors: "F", promod: "F",
        searchType: "all", pageNumber: "1", pageSize: "5"
      });
      const apiUrl = `${BASE}?${params}`;

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
      }, apiUrl, capturedToken);

      console.log(`[Checker] API call: status=${result.status} len=${result.body?.length}`);

      if (result.body && result.body.length > 10) {
        classData = JSON.parse(result.body);
      }
    }

    await page.close();

    if (!classData || !classData.classes) {
      return { found: false };
    }

    const classes = classData.classes;
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
