// src/checker.js
const puppeteer = require("puppeteer-core");

const BASE = "https://catalog.apps.asu.edu/catalog/classes/classlist";

let browser = null;
let sharedPage = null;

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

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  const url = `${BASE}?campusOrOnlineSelection=A&classNbr=${classNumber}&honors=F&promod=F&searchType=all&term=${term}`;

  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set up response interception BEFORE navigating
    let classData = null;
    page.on("response", async (response) => {
      const rUrl = response.url();
      if (rUrl.includes("catalog-microservices") && rUrl.includes("classes")) {
        try {
          const text = await response.text();
          console.log(`[Checker] API response status: ${response.status()} length: ${text.length}`);
          const json = JSON.parse(text);
          if (json && json.classes) {
            classData = json;
            console.log(`[Checker] Got ${json.classes.length} classes`);
          }
        } catch(e) {
          console.log(`[Checker] API parse error: ${e.message}`);
        }
      }
    });

    await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 });
    await new Promise(r => setTimeout(r, 5000));

    if (!classData) {
      console.log(`[Checker] No API data intercepted for ${classNumber}`);
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
    await page.close().catch(() => {});
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
