// src/checker.js
const fetch = require("node-fetch");

const BASE = "https://webapp4.asu.edu/catalog/classlist";

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  const params = new URLSearchParams({
    strm: String(term),
    classNbr: String(classNumber),
    hon: "F",
    promod: "F",
    searchType: "all",
    seats: "F"
  });

  const targetUrl = `${BASE}?${params}`;

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

  // If we got a tiny response it's not the real page
  if (html.length < 1000) {
    console.log(`[Checker] Page too small, likely redirect: ${html.substring(0, 200)}`);
    throw new Error("UNEXPECTED_RESPONSE");
  }

  // Check if class number appears in the page
  if (!html.includes(String(classNumber))) {
    console.log(`[Checker] Class ${classNumber} not found in page`);
    return { found: false };
  }

  // Look for open seats — webapp4 uses iconOpenClass or similar
  // Find the section around our class number
  const classIndex = html.indexOf(String(classNumber));
  const surrounding = html.substring(Math.max(0, classIndex - 1000), classIndex + 2000);

  // Log snippet so we can see the HTML structure
  console.log(`[Checker] HTML snippet: ${surrounding.substring(0, 600)}`);

  // Check for open/closed indicators
  const isOpen = surrounding.includes("iconOpenClass") ||
                 surrounding.includes("open_class") ||
                 surrounding.includes("class_open") ||
                 surrounding.includes("Open") && !surrounding.includes("Closed");

  // Try to find enrollment like "49 of 100" or "49/100"
  let enrollTotal = 0, enrollCap = 0;
  const enrollMatch = surrounding.match(/(\d+)\s+of\s+(\d+)/i) ||
                      surrounding.match(/(\d+)\/(\d+)/);
  if (enrollMatch) {
    enrollTotal = parseInt(enrollMatch[1]);
    enrollCap = parseInt(enrollMatch[2]);
  }

  // Try to get title
  const titleMatch = surrounding.match(/<td[^>]*>([A-Z][^<]{5,60})<\/td>/);
  const title = titleMatch ? titleMatch[1].trim() : "";

  console.log(`[Checker] ${classNumber}: found=true open=${isOpen} ${enrollTotal}/${enrollCap}`);
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
