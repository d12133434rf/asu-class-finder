// src/checker.js
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

const BASE = "https://webapp4.asu.edu/catalog/coursedetails";

function getProxyAgent() {
  const proxyHost = process.env.PROXY_HOST || "gw.dataimpulse.com";
  const proxyPort = process.env.PROXY_PORT || "823";
  const proxyUser = process.env.PROXY_USER || "";
  const proxyPass = process.env.PROXY_PASS || "";
  return new HttpsProxyAgent(`http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`);
}

async function checkClass(classNumber, term) {
  console.log(`[Checker] Fetching class ${classNumber} term ${term}`);

  const targetUrl = `${BASE}?r=${classNumber}`;
  const agent = getProxyAgent();

  const res = await fetch(targetUrl, {
    agent,
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

  if (html.length < 1000) {
    console.log(`[Checker] Small response: ${html.substring(0, 200)}`);
    throw new Error("UNEXPECTED_RESPONSE");
  }

  if (html.includes("were found that matched your criteria") || html.includes("noResults")) {
    console.log(`[Checker] Class ${classNumber} not found`);
    return { found: false };
  }

  const seatsMatch = html.match(/(\d+)\s+of\s+(\d+)/);
  if (!seatsMatch) {
    console.log(`[Checker] No seat info found, snippet: ${html.substring(0, 500)}`);
    return { found: false };
  }

  const enrollTotal = parseInt(seatsMatch[1]);
  const enrollCap = parseInt(seatsMatch[2]);
  const isOpen = enrollTotal < enrollCap;

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
