// src/checker.js
const fetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");
const cheerio = require("cheerio");

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
  const $ = cheerio.load(html);

  // Find the row matching our class number
  let found = false;
  let isOpen = false;
  let enrollTotal = 0;
  let enrollCap = 0;
  let title = "";

  // ASU's classlist table has rows with class data
  $("table tr").each((i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 3) return;

    const rowText = $(row).text();
    if (rowText.includes(String(classNumber))) {
      found = true;

      // Look for open seats indicator
      const openImg = $(row).find("img[src*='open']").length > 0;
      const closedImg = $(row).find("img[src*='closed']").length > 0;

      // Try to find enrollment numbers
      cells.each((j, cell) => {
        const text = $(cell).text().trim();
        const match = text.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          enrollTotal = parseInt(match[1]);
          enrollCap = parseInt(match[2]);
        }
      });

      isOpen = openImg && !closedImg;

      // Get title from first meaningful cell
      title = $(cells[0]).text().trim() || "";

      return false; // break
    }
  });

  console.log(`[Checker] ${classNumber}: found=${found} open=${isOpen} ${enrollTotal}/${enrollCap}`);
  return { found, isOpen, enrollTotal, enrollCap, title };
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
