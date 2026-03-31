require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 100, message: { error: "Too many requests" } });
app.use("/api/", limiter);
const watchLimiter = rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: "Too many requests" } });
app.use("/api/watch", watchLimiter);

app.use("/api", require("./routes/api"));
app.use(express.static(path.join(__dirname, "../public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));

app.listen(PORT, () => {
  console.log(`🎯 SeatSniper ASU running on http://localhost:${PORT}`);
  require("./scheduler").start();
});

module.exports = app;