require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// Stripe webhook needs raw body first
app.use("/api/subscription/webhook", express.raw({ type: "application/json" }));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200, message: { error: "Too many requests" } });
app.use("/api/", limiter);

app.use("/api/auth", require("./routes/auth"));
app.use("/api", require("./routes/api"));
app.use("/api/subscription", require("./routes/stripe"));

// All routes serve the SPA
app.use(express.static(path.join(__dirname, "../public")));
app.get("/verify-email.html", (req, res) => res.sendFile(path.join(__dirname, "../public/verify-email.html")));
app.get("/reset-password.html", (req, res) => res.sendFile(path.join(__dirname, "../public/reset-password.html")));
app.get("/privacy.html", (req, res) => res.sendFile(path.join(__dirname, "../public/privacy.html")));
app.get("/terms.html", (req, res) => res.sendFile(path.join(__dirname, "../public/terms.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));

app.listen(PORT, () => {
  console.log(`🎯 SeatSniper ASU running on http://localhost:${PORT}`);
  require("./scheduler").start();
});

module.exports = app;
