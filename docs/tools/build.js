#!/usr/bin/env node
/*
 * THE CONCATENATOR.
 *
 * The browser used to fetch thirty-five separate modules before the game
 * existed. On localhost that is free; on a phone on a train it is the
 * difference between instant and a wait.
 *
 * This is deliberately not a bundler. There is no module system, no
 * transpile, no minifier and no dependency graph - the load order is a list a
 * person maintains, and the whole job is `cat` in that order. Every source
 * file reaches app.js byte for byte, which means:
 *
 *   - the sources stay the truth, and stay readable on the deployed site
 *   - a stack trace in app.js can be mapped back by the index at the top
 *   - the "no build step" promise costs one command, not a toolchain
 *
 * Run:  node tools/build.js          (writes docs/app.js)
 *       node tools/build.js --check  (exits 1 if app.js is stale)
 *
 * The smoke test runs the --check half itself, so a source edit that never
 * rebuilt cannot reach the site.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const DOCS = path.join(__dirname, "..");
const MANIFEST = path.join(DOCS, "src", "manifest.json");
const OUT = path.join(DOCS, "app.js");

function build(){
  const files = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).files;

  /*
   * A leading semicolon between files, so a source that ever loses its
   * trailing one cannot glue itself to the next file's opening paren and turn
   * two modules into a function call.
   */
  const body = files.map(f =>
    "\n;/* ===== " + f + " ===== */\n" + fs.readFileSync(path.join(DOCS, f), "utf8")
  ).join("\n");

  /*
   * The index is MEASURED, not predicted. Computing it from the sizes of the
   * pieces was off by exactly one line - which is the least useful kind of
   * wrong in a table whose whole job is mapping a stack trace back to a file.
   * So: find where each file's first line actually landed in the body, then
   * add however many lines the header itself turns out to be.
   */
  const bodyLines = body.split("\n");
  const marks = files.map(f => {
    const at = bodyLines.indexOf(";/* ===== " + f + " ===== */");
    return { f, line: at + 2 };            // +1 for 1-based, +1 to skip the marker
  });

  const render = idx =>
    "/* Built by tools/build.js - DO NOT EDIT. Edit src/*.js and rebuild.\n" +
    " *\n" +
    " * Concatenation only: every source file is here byte for byte, in the\n" +
    " * order src/manifest.json declares. A line number in a stack trace maps\n" +
    " * back through this index - each number is the file's FIRST line.\n" +
    " *\n" +
    idx.map(e => " *   " + String(e.line).padStart(6) + "  " + e.f).join("\n") +
    "\n */";

  /*
   * Measured against the FINAL string, not against the body: the header's last
   * line and the body's first share a line break, so a body-local number is
   * one too high once the header is on. Two renders settle it, because the
   * header's line COUNT is the same whatever numbers it holds - so the
   * geometry of the second output is identical to the first.
   */
  const placeholder = render(marks) + body;
  const lines = placeholder.split("\n");
  const real = files.map(f => ({
    f, line: lines.indexOf(";/* ===== " + f + " ===== */") + 2,
  }));
  return render(real) + body;
}

const out = build();
if(process.argv.indexOf("--check") >= 0){
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if(have !== out){
    console.error("app.js is STALE. Run: node tools/build.js");
    process.exit(1);
  }
  console.log("app.js is up to date (" + Math.round(out.length/1024) + "KB)");
} else {
  fs.writeFileSync(OUT, out);
  console.log("wrote app.js: " + Math.round(out.length/1024) + "KB from " +
              JSON.parse(fs.readFileSync(MANIFEST, "utf8")).files.length + " files");
}
