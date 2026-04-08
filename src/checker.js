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
      if (["image", "font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 });

    // Wait extra time for React to render class data
    await new Promise(r => setTimeout(r, 5000));

    const html = await page.content();
    console.log(`[Checker] HTML length: ${html.length}`);

    // Search for seat patterns
    const patterns = [
      /(\d+)\s*of\s*(\d+)\s*seat/i,
      /(\d+)\s*\/\s*(\d+)\s*seat/i,
      /seats?\s*available[:\s]*(\d+)/i,
      /ENRL_TOT['":\s]+(\d+)/i,
      /(\d+)\s*open\s*seat/i,
      /open seats?[:\s]*(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        console.log(`[Checker] Matched pattern ${pattern}: ${match[0]}`);
      }
    }

    // Log any text containing numbers near "seat" or "open"
    const seatIdx = html.search(/\d+\s*(of|\/)\s*\d+/);
    if (seatIdx > -1) {
      console.log(`[Checker] Number pattern found: ${html.substring(seatIdx - 100, seatIdx + 100)}`);
    } else {
      console.log(`[Checker] No number pattern found`);
      // Log end of page which usually has rendered content
      console.log(`[Checker] End of page: ${html.substring(html.length - 1000)}`);
    }

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
