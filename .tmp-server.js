"use strict";

const path = require("path");

process.env.NODE_ENV = "production";
process.chdir(__dirname);

const port = parseInt(process.env.PORT || "10020", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";

const { startServer } = require("next/dist/server/lib/start-server");

startServer({
  dir: path.join(__dirname),
  isDev: false,
  hostname,
  port,
  allowRetry: false,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
