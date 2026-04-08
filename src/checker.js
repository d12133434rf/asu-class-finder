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

    // Block images, fonts, stylesheets to save memory
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

    // Wait for class data to load
    await page.waitForSelector(".class-info, .no-results, [class*='class']", { timeout: 15000 }).catch(() => {});

    const html = await page.content();
    console.log(`[Checker] HTML length: ${html.length}`);

    // Look for seat info "X of Y"
    const seatsMatch = html.match(/(\d+)\s+of\s+(\d+)/);
    if (!seatsMatch) {
      console.log(`[Checker] No seat info found for ${classNumber}`);
      return { found: false };
    }

    const enrollTotal = parseInt(seatsMatch[1]);
    const enrollCap = parseInt(seatsMatch[2]);
    const isOpen = enrollTotal < enrollCap;

    const titleMatch = html.match(/<h2[^>]*>([^<]+)/);
    const title = titleMatch ? titleMatch[1].trim().split("-")[0].trim() : "";

    console.log(`[Checker] ${classNumber}: ${enrollTotal}/${enrollCap} open=${isOpen}`);
    return { found: true, isOpen, enrollTotal, enrollCap, title };

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
