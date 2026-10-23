#!/usr/bin/env node
/**
 * smoke: checks that a cafe's site answers and is the release it should be.
 * `smoke --help` lists the options; README.md has the details.
 */
import { main } from "../src/smoke-cli.mjs";

process.exitCode = await main(process.argv.slice(2));
