// Explicit offline validation preload; never use for the deployed application.
// react-scripts otherwise reads operational .env files even in test mode.
const Module = require("module");
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === "dotenv") return { config: () => ({ parsed: {} }), parse: () => ({}) };
  if (id === "dotenv/config") return {};
  return load.call(this, id, ...args);
};
