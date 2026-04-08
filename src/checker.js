// src/checker.js
const puppeteer = require("puppeteer-core");

const BASE = "https://catalog.apps.asu.edu/catalog/classes/classlist";

let browser = null;

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

  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector("body", { timeout: 15000 }).catch(() => {});

    const html = await page.content();

    // Log a chunk around enrollment-related keywords
    const keywords = ["seat", "enroll", "open", "avail", "of ", "Seat", "Enroll", "Open"];
    for (const kw of keywords) {
      const idx = html.indexOf(kw);
      if (idx > -1) {
        console.log(`[Checker] Found "${kw}" at ${idx}: ...${html.substring(idx - 50, idx + 150)}...`);
        break;
      }
    }

    // Also log a chunk of the middle of the page
    const mid = Math.floor(html.length / 2);
    console.log(`[Checker] Mid-page snippet: ${html.substring(mid, mid + 500)}`);

    return { found: false };

  } finally {
    if (page) await page.close().catch(() => {});
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
