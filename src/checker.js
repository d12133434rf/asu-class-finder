// src/checker.js
const fetch = require("node-fetch");

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  // Try webapp4 first - historically more open
  try {
    const url = `https://webapp4.asu.edu/catalog/myclasslistresult?strm=${term}&class_nbr=${classNumber}&seats=true`;
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://webapp4.asu.edu/catalog/",
      },
      timeout: 10000
    });

    console.log(`[Checker] webapp4 Response: ${res.status}`);

    if (res.ok) {
      const text = await res.text();
      console.log(`[Checker] webapp4 body: ${text.substring(0, 200)}`);

      // Parse the response
      const data = JSON.parse(text);
      if (!data || !data.classes || !data.classes.length) return { found: false };

      const match = data.classes[0];
      const enrollTotal = parseInt(match.ENRL_TOT ?? match.enrl_tot ?? "0", 10);
      const enrollCap = parseInt(match.ENRL_CAP ?? match.enrl_cap ?? "0", 10);
      const classStatus = match.CLASS_STAT ?? match.class_stat ?? "";
      const title = match.COURSE_TITLE ?? match.course_title ?? "";
      const isOpen = enrollTotal < enrollCap && classStatus === "A";

      console.log(`[Checker] ${classNumber}: ${enrollTotal}/${enrollCap} status=${classStatus} open=${isOpen}`);
      return { found: true, isOpen, enrollTotal, enrollCap, title };
    }
  } catch(e) {
    console.log(`[Checker] webapp4 error: ${e.message}`);
  }

  // Fallback to main API with bearer token
  try {
    const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";
    const params = new URLSearchParams({
      refine: "Y", term: String(term), classNbr: String(classNumber),
      campusOrOnlineSelection: "A", honors: "F", promod: "F",
      searchType: "all", pageNumber: "1", pageSize: "5"
    });

    const token = process.env.ASU_BEARER_TOKEN || "";
    const res = await fetch(`${BASE}?${params}`, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Authorization": `Bearer ${token}`,
        "Origin": "https://classSearch.asu.edu",
        "Referer": "https://classSearch.asu.edu/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 10000
    });

    console.log(`[Checker] Main API Response: ${res.status}`);
    if (res.status === 401) throw new Error("AUTH_REQUIRED");
    if (!res.ok) throw new Error(`HTTP_${res.status}`);

    const data = await res.json();
    const classes = data?.classes ?? [];
    if (!classes.length) return { found: false };

    const match = classes[0];
    const enrollTotal = parseInt(match.ENRL_TOT ?? "0", 10);
    const enrollCap = parseInt(match.ENRL_CAP ?? "0", 10);
    const classStatus = match.CLASS_STAT ?? "";
    const title = match.COURSE_TITLE ?? "";
    const isOpen = enrollTotal < enrollCap && classStatus === "A";

    return { found: true, isOpen, enrollTotal, enrollCap, title };
  } catch(e) {
    throw e;
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
