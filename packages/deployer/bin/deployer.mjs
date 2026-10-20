#!/usr/bin/env node
/**
 * deployer: sets up a cafe owner's Firebase project and deploys CafeMenu to
 * it. `deployer --help` lists the commands; README.md has the details.
 */
import { main } from "../src/cli.mjs";

process.exitCode = await main(process.argv.slice(2));
