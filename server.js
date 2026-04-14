const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  const host = req.hostname;

  if (host === "hukuk.iterasyon.com" || host.startsWith("hukuk.")) {
    express.static(path.join(__dirname, "hukuk"))(req, res, next);
  } else {
    next();
  }
});

app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
