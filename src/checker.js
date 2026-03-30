// src/checker.js
// Scrapes the public ASU class search HTML page directly.
// No auth token needed — the page is publicly accessible.

const fetch = require("node-fetch");

const SEARCH_URL = "https://catalog.apps.asu.edu/catalog/classes/classlist";

async function checkClass(classNumber, term) {
  // ASU's public class search page — no login required
  const url = `${SEARCH_URL}?term=${term}&classNbr=${classNumber}&searchType=all&campusOrOnlineSelection=A&honors=F&promod=F&collapse=Y`;

  const res = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Cache-Control": "no-cache"
    }
  });

  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const html = await res.text();

  // The page is a React SPA — the data is injected as JSON in a script tag
  // Look for the __NEXT_DATA__ or window.__data__ pattern
  let classes = [];

  // Try extracting JSON data embedded in the page
  const jsonMatch = html.match(/__NEXT_DATA__\s*=\s*(\{.+?\})\s*<\/script>/s) ||
                    html.match(/window\.__data__\s*=\s*(\{.+?\})\s*;/s) ||
                    html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\})\s*;/s);

  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      // Dig through Next.js page props to find class data
      const pageProps = data?.props?.pageProps || data?.pageProps || data;
      classes = pageProps?.classes || pageProps?.data?.classes || pageProps?.searchResults || [];
    } catch(e) {}
  }

  // Fallback: parse HTML for open seat indicators
  if (classes.length === 0) {
    return parseHtmlForSeats(html, classNumber);
  }

  const match = classes.find(c =>
    String(c.CLASS_NBR || c.classNbr || c.classNumber || "") === String(classNumber)
  ) || classes[0];

  if (!match) return { found: false };

  const enrollTotal = parseInt(match.ENRL_TOT ?? match.enrollTotal ?? "0", 10);
  const enrollCap   = parseInt(match.ENRL_CAP ?? match.enrollCap ?? "0", 10);
  const classStatus = match.CLASS_STAT ?? match.classStatus ?? "";
  const title       = match.COURSE_TITLE ?? match.courseTitle ?? match.title ?? "";
  const isOpen      = enrollTotal < enrollCap && classStatus === "A";

  return { found: true, isOpen, enrollTotal, enrollCap, title };
}

function parseHtmlForSeats(html, classNumber) {
  // Look for the green dot (open) vs red dot (closed) pattern ASU uses
  // ASU renders: "21 of 140" for open seats
  const openPattern = /(\d+)\s+of\s+(\d+)/g;
  const matches = [...html.matchAll(openPattern)];

  if (matches.length > 0) {
    // Take the first match near our class number in the HTML
    const classPos = html.indexOf(String(classNumber));
    let bestMatch = null;
    let bestDist = Infinity;

    for (const m of matches) {
      const dist = Math.abs(m.index - classPos);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = m;
      }
    }

    if (bestMatch && bestDist < 5000) {
      const open = parseInt(bestMatch[1], 10);
      const total = parseInt(bestMatch[2], 10);
      const filled = total - open;
      return { found: true, isOpen: open > 0, enrollTotal: filled, enrollCap: total, title: "" };
    }
  }

  // Check for "No classes" message
  if (html.includes("No classes found") || html.includes("no results found") || html.length < 1000) {
    return { found: false };
  }

  // If we can't parse seats but the class page loaded, mark as unknown
  // Check for open/closed status text
  if (html.includes(`"${classNumber}"`) || html.includes(`'${classNumber}'`)) {
    const isOpen = html.includes("Open") && !html.includes("Closed");
    return { found: true, isOpen, enrollTotal: 0, enrollCap: 0, title: "" };
  }

  return { found: false };
}

// Fetch available terms — uses the public terms endpoint
async function fetchTerms() {
  // Try the public catalog terms endpoint (no auth needed)
  const endpoints = [
    "https://catalog.apps.asu.edu/catalog-microservices/api/v1/terms",
    "https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/terms"
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const terms = (data || [])
        .map(t => ({ code: String(t.STRM ?? t.strm ?? ""), label: t.DESCR ?? t.descr ?? "" }))
        .filter(t => t.code && t.label)
        .sort((a, b) => Number(a.code) - Number(b.code));
      if (terms.length > 0) return terms;
    } catch(e) {}
  }

  // Hard fallback
  return [
    { code: "2261", label: "Fall 2025" },
    { code: "2271", label: "Spring 2026" },
    { code: "2277", label: "Summer 2026" },
    { code: "2281", label: "Fall 2026" }
  ];
}

module.exports = { checkClass, fetchTerms };
