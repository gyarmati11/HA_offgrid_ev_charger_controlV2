// Build: node card_src/build.js  →  custom_components/offgrid_ev_charger/www/offgrid-ev-card.js
// Compiles to ES2017 so the card also runs on older Android WebViews / HA "es5" frontend.
const fs = require("fs");
const path = require("path");
const ts = require(process.env.TS_PATH || "typescript");
const src = fs.readFileSync(path.join(__dirname, "offgrid-ev-card.js"), "utf8");
const out = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None, allowJs: true, removeComments: false },
});
const banner = "/* Off-Grid EV Charger card – GENERATED from card_src/offgrid-ev-card.js (ES2017). Edit the source, then run card_src/build.js */\n";
fs.writeFileSync(path.join(__dirname, "..", "custom_components", "offgrid_ev_charger", "www", "offgrid-ev-card.js"), banner + out.outputText);
console.log("built", out.outputText.length, "bytes");
