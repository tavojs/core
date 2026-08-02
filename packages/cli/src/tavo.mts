#!/usr/bin/env node
import { getCliVersion } from "./cli/args.mjs";
import { formatCliError } from "./cli/errors.mjs";
import { runCli } from "./cli/index.mjs";

const version = await getCliVersion(import.meta.url);
const argv = process.argv.slice(2);
const debug = argv.includes("--debug");

runCli(argv, { version }).catch((error) => {
  console.error(formatCliError(error, debug));
  process.exitCode = 1;
});
