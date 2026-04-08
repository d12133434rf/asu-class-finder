// src/checker.js
const fetch = require("node-fetch");

const BASE = "https://webapp4.asu.edu/catalog/coursedetails";

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  const targetUrl = `${BASE}?r=${classNumber}`;

  const res = await fetch(targetUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    timeout: 30000
  });

  console.log(`[Checker] Response: ${res.status}`);
  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const html = await res.text();
  console.log(`[Checker] HTML length: ${html.length}`);

  // Check if it's a React shell (too small)
  if (html.length < 1000) {
    console.log(`[Checker] Unexpected small response: ${html.substring(0, 200)}`);
    throw new Error("UNEXPECTED_RESPONSE");
  }

  // Check for no results
  if (html.includes("were found that matched your criteria") || html.includes("noResults")) {
    console.log(`[Checker] Class ${classNumber} not found`);
    return { found: false };
  }

  // Extract seats like "49 of 100"
  const seatsMatch = html.match(/(\d+)\s+of\s+(\d+)/);
  if (!seatsMatch) {
    console.log(`[Checker] Could not find seat info in page`);
    console.log(`[Checker] HTML snippet: ${html.substring(0, 800)}`);
    return { found: false };
  }

  const enrollTotal = parseInt(seatsMatch[1]);
  const enrollCap = parseInt(seatsMatch[2]);
  const isOpen = enrollTotal < enrollCap;

  // Try to get title
  const titleMatch = html.match(/<h2[^>]*>([^<]+)/);
  const title = titleMatch ? titleMatch[1].trim().split("-")[0].trim() : "";

  console.log(`[Checker] ${classNumber}: ${enrollTotal}/${enrollCap} open=${isOpen} title=${title}`);
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
