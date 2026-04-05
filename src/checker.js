// src/checker.js
const fetch = require("node-fetch");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  const params = new URLSearchParams({
    refine: "Y", term: String(term), classNbr: String(classNumber),
    campusOrOnlineSelection: "A", honors: "F", promod: "F",
    searchType: "all", pageNumber: "1", pageSize: "5"
  });

  const targetUrl = `${BASE}?${params}`;
  const scraperKey = process.env.SCRAPER_API_KEY || "";
  const token = process.env.ASU_BEARER_TOKEN || "";

  // Route through ScraperAPI to bypass IP blocks
  const proxyUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(targetUrl)}`;

  const res = await fetch(proxyUrl, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Authorization": `Bearer ${token}`,
      "Origin": "https://classSearch.asu.edu",
      "Referer": "https://classSearch.asu.edu/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    timeout: 30000
  });

  console.log(`[Checker] Response: ${res.status}`);

  if (res.status === 401) throw new Error("AUTH_REQUIRED");
  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const data = await res.json();
  const classes = data?.classes ?? [];
  console.log(`[Checker] Classes found: ${classes.length}`);
  if (!classes.length) return { found: false };

  const match = classes[0];
  const enrollTotal = parseInt(match.ENRL_TOT ?? "0", 10);
  const enrollCap   = parseInt(match.ENRL_CAP ?? "0", 10);
  const classStatus = match.CLASS_STAT ?? "";
  const title       = match.COURSE_TITLE ?? "";
  const isOpen      = enrollTotal < enrollCap && classStatus === "A";

  console.log(`[Checker] ${classNumber}: ${enrollTotal}/${enrollCap} status=${classStatus} open=${isOpen}`);
  return { found: true, isOpen, enrollTotal, enrollCap, title };
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
