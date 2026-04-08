// src/checker.js
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);
  const params = new URLSearchParams({
    refine: "Y", term: String(term), classNbr: String(classNumber),
    campusOrOnlineSelection: "A", honors: "F", promod: "F",
    searchType: "all", pageNumber: "1", pageSize: "5"
  });
  const targetUrl = `${BASE}?${params}`;

  // DataImpulse residential proxy
  const proxyHost = process.env.PROXY_HOST || "gw.dataimpulse.com";
  const proxyPort = process.env.PROXY_PORT || "823";
  const proxyUser = process.env.PROXY_USER || "";
  const proxyPass = process.env.PROXY_PASS || "";
  const proxyUrl  = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;
  const agent     = new HttpsProxyAgent(proxyUrl);

  const res = await fetch(targetUrl, {
    agent,
    headers: {
      "Accept": "application/json, text/plain, */*",
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
