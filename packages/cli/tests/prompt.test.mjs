import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { promptForProjectName } from "../dist/cli/prompt.mjs";

test("promptForProjectName retries empty input and trims the project name", async () => {
  let output = "";
  const name = await promptForProjectName({
    input: Readable.from(["  \n  my-app  \n"]),
    output: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    }),
  });

  assert.equal(name, "my-app");
  assert.equal(
    output,
    "Project name: Project name cannot be empty.\nProject name: ",
  );
});

test("promptForProjectName returns a normal cancellation on closed input", async () => {
  let output = "";
  const name = await promptForProjectName({
    input: Readable.from([]),
    output: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    }),
  });

  assert.equal(name, null);
  assert.equal(output, "Project name: \n");
});
