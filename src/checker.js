const axios = require('axios');

const BASE = "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes";

async function checkClass(classNumber, term) {
  const token = process.env.ASU_AUTH_TOKEN;
  const cookie = process.env.ASU_SESSION_COOKIE;

  if (!token && !cookie) {
    console.error("[Checker] ERROR: No Auth Token or Cookie found in Railway variables!");
    throw new Error("AUTH_REQUIRED");
  }

  try {
    const params = {
      refine: "Y",
      term: String(term),
      classNbr: String(classNumber),
      campusOrOnlineSelection: "A",
      searchType: "all",
      pageSize: "1"
    };

    const res = await axios.get(BASE, {
      params,
      headers: {
        "Accept": "application/json",
        // Uses the Bearer token if you provided it, otherwise falls back to Cookie
        "Authorization": token ? `Bearer ${token}` : undefined,
        "Cookie": cookie || undefined,
        "Origin": "https://classSearch.asu.edu",
        "Referer": "https://classSearch.asu.edu/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    const classes = res.data?.classes ?? [];
    if (!classes.length) return { found: false };

    const match = classes[0];
    const enrollTotal = parseInt(match.ENRL_TOT ?? "0", 10);
    const enrollCap = parseInt(match.ENRL_CAP ?? "0", 10);
    const isOpen = enrollTotal < enrollCap && match.CLASS_STAT === "A";

    console.log(`[Checker] #${classNumber}: ${enrollTotal}/${enrollCap} | Open: ${isOpen}`);
    
    return {
      found: true,
      isOpen,
      enrollTotal,
      enrollCap,
      title: match.COURSE_TITLE || "ASU Class"
    };

  } catch (error) {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      console.error("[Checker] Auth expired or invalid.");
      throw new Error("AUTH_REQUIRED");
    }
    throw error;
  }
}

async function fetchTerms() {
  return [
    { code: "2261", label: "Spring 2026" },
    { code: "2267", label: "Summer 2026" },
    { code: "2271", label: "Fall 2026" }
  ];
}

module.exports = { checkClass, fetchTerms };