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
  const browserlessToken = process.env.BROWSERLESS_TOKEN || "";
  const asuCookie = process.env.ASU_COOKIE || "";
  const asuToken = process.env.ASU_BEARER_TOKEN || "";

  // Use Browserless /unblock endpoint which bypasses Cloudflare
  const res = await fetch(`https://production-sfo.browserless.io/unblock?token=${browserlessToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: targetUrl,
      browserWSEndpoint: true,
      cookies: true,
      content: true,
      screenshot: false,
      extraHTTPHeaders: {
        "Accept": "application/json, text/plain, */*",
        "Authorization": `Bearer ${asuToken}`,
        "Origin": "https://catalog.apps.asu.edu",
        "Referer": "https://catalog.apps.asu.edu/",
        "Cookie": asuCookie
      }
    }),
    timeout: 30000
  });

  console.log(`[Checker] Unblock response: ${res.status}`);
  const data = await res.json();
  console.log(`[Checker] Unblock data keys: ${Object.keys(data).join(", ")}`);
  console.log(`[Checker] Content preview: ${JSON.stringify(data).substring(0, 300)}`);

  return { found: false };
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
