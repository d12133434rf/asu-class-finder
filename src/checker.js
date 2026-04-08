// src/checker.js
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

const BASE = "https://webapp4.asu.edu/catalog/classlist";

function getProxyAgent() {
  const proxyHost = process.env.PROXY_HOST || "gw.dataimpulse.com";
  const proxyPort = process.env.PROXY_PORT || "823";
  const proxyUser = process.env.PROXY_USER || "";
  const proxyPass = process.env.PROXY_PASS || "";
  return new HttpsProxyAgent(`http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`);
}

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
  const agent = getProxyAgent();

  const res = await fetch(targetUrl, {
    agent,
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    timeout: 30000
  });

  console.log(`[Checker] Response: ${res.status}`);
  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const html = await res.text();
  console.log(`[Checker] HTML length: ${html.length}`);

  // Check if we got redirected to a login page
  if (html.includes("weblogin.asu.edu") || html.includes("Sign In") && html.length < 5000) {
    throw new Error("AUTH_REQUIRED");
  }

  // Check if class number appears in the page
  if (!html.includes(String(classNumber))) {
    console.log(`[Checker] Class ${classNumber} not found in page`);
    return { found: false };
  }

  // Look for open seats indicator — ASU uses "open" class or green dot
  const classIndex = html.indexOf(String(classNumber));
  const surrounding = html.substring(Math.max(0, classIndex - 500), classIndex + 1000);

  const isOpen = surrounding.includes('class-open') ||
                 surrounding.includes('open-seats') ||
                 surrounding.includes('"open"') ||
                 surrounding.includes('iconOpenClass') ||
                 surrounding.includes('seats available');

  // Try to find enrollment numbers like "49 of 100"
  let enrollTotal = 0, enrollCap = 0;
  const enrollMatch = surrounding.match(/(\d+)\s+of\s+(\d+)/);
  if (enrollMatch) {
    enrollTotal = parseInt(enrollMatch[1]);
    enrollCap = parseInt(enrollMatch[2]);
  }

  console.log(`[Checker] ${classNumber}: found=true open=${isOpen} ${enrollTotal}/${enrollCap}`);
  console.log(`[Checker] Surrounding HTML snippet: ${surrounding.substring(0, 300)}`);

  return { found: true, isOpen, enrollTotal, enrollCap, title: "" };
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
