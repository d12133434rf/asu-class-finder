// src/checker.js
const puppeteer = require("puppeteer-core");

const BASE = "https://catalog.apps.asu.edu/catalog/classes/classlist";

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  const url = `${BASE}?campusOrOnlineSelection=A&classNbr=${classNumber}&honors=F&promod=F&searchType=all&term=${term}`;
  const token = process.env.BROWSERLESS_TOKEN || "";

  let browser = null;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://production-sfo.browserless.io?token=${token}&stealth=true`,
    });

    const page = await browser.newPage();

    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "media", "stylesheet"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Intercept the API response
    let classData = null;
    page.on("response", async (response) => {
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
    });

    await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));

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
