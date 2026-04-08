// src/checker.js
const puppeteer = require("puppeteer-core");

const BASE = "https://catalog.apps.asu.edu/catalog/classes/classlist";

let browser = null;
let interceptedToken = null;

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

function parseCookieString(cookieStr) {
  return cookieStr.split(";").map(pair => {
    const [name, ...rest] = pair.trim().split("=");
    return {
      name: name.trim(),
      value: rest.join("=").trim(),
      domain: ".asu.edu",
      path: "/",
    };
  }).filter(c => c.name && c.value);
}

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  const url = `${BASE}?campusOrOnlineSelection=A&classNbr=${classNumber}&honors=F&promod=F&searchType=all&term=${term}`;
  const cookieStr = process.env.ASU_COOKIE || "";

  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    // Set cookies before navigation
    if (cookieStr) {
      const cookies = parseCookieString(cookieStr);
      await page.setCookie(...cookies);
      console.log(`[Checker] Set ${cookies.length} cookies`);
    }

    // Intercept API calls to capture the Bearer token and class data
    let classData = null;
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("catalog-microservices") && url.includes("classes")) {
        try {
          const json = await response.json();
          if (json && json.classes) {
            classData = json;
            console.log(`[Checker] Intercepted API response with ${json.classes.length} classes`);
          }
        } catch(e) {}
      }
    });

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
