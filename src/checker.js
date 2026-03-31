// src/checker.js - Uses ASU's public search API (no auth required)
const fetch = require("node-fetch");

// This is the public API used by asuclassfinder.com and similar sites
// It doesn't require authentication when called with proper headers
const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";

async function checkClass(classNumber, term) {
  const params = new URLSearchParams({
    refine: "Y",
    term: String(term),
    classNbr: String(classNumber),
    campusOrOnlineSelection: "A",
    honors: "F",
    promod: "F",
    searchType: "all",
    pageNumber: "1",
    pageSize: "5"
  });

  const url = `${BASE}?${params}`;
  console.log(`[Checker] GET ${url}`);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Origin": "https://classSearch.asu.edu",
      "Referer": "https://classSearch.asu.edu/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"'
    }
  });

  console.log(`[Checker] Response: ${res.status} ${res.statusText}`);

  if (res.status === 401) throw new Error("AUTH_REQUIRED");
  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const text = await res.text();
  console.log(`[Checker] Body (first 300): ${text.substring(0, 300)}`);

  let data;
  try {
    data = JSON.parse(text);
  } catch(e) {
    throw new Error(`JSON_PARSE_FAILED: ${text.substring(0, 100)}`);
  }

  const classes = data?.classes ?? data?.data?.classes ?? data?.results ?? [];
  console.log(`[Checker] Found ${classes.length} classes`);

  if (!classes.length) return { found: false };

  const match = classes[0];
  const enrollTotal = parseInt(match.ENRL_TOT ?? "0", 10);
  const enrollCap   = parseInt(match.ENRL_CAP ?? "0", 10);
  const classStatus = match.CLASS_STAT ?? "";
  const title       = match.COURSE_TITLE ?? match.courseTitle ?? "";
  const isOpen      = enrollTotal < enrollCap && classStatus === "A";

  console.log(`[Checker] Class ${classNumber}: ${enrollTotal}/${enrollCap}, status=${classStatus}, isOpen=${isOpen}`);
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