// src/server.js - Main Express server
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: "Too many requests, please try again later" }
});
app.use("/api/", limiter);

// Strict limit for watch creation
const watchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: "Too many watch requests from this IP" }
});
app.use("/api/watch", watchLimiter);

// API routes
app.use("/api", require("./routes/api"));

// Serve frontend
app.use(express.static(path.join(__dirname, "../public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🎯 SeatSniper ASU running on http://localhost:${PORT}\n`);

  // Start the background scheduler
  const { start } = require("./scheduler");
  start();
});

module.exports = app;
