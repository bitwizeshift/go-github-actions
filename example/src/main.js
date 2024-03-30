import { env } from "process";

const fs = require("fs");
const path = require("path");
const core = require("@actions/core");
const { tmpdir } = require("os");

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
async function run() {
  try {
    require("./wasm_exec");

    const wasmPath = path.join(__dirname, "main.wasm");

    const go = new Go();
    go.argv = process.argv.slice(2);
    go.env = Object.assign(
      { TMPDIR: env.RUNNER_TEMP || tmpdir() },
      process.env
    );
    go.exit = process.exit;
    core.info(JSON.stringify(go));
    core.info(JSON.stringify(go.importObject));
    WebAssembly.instantiate(fs.readFileSync(wasmPath), go.importObject)
      .then((result) => {
        process.on("exit", (code) => {
          // Node.js exits if no event handler is pending
          if (code === 0 && !go.exited) {
            // deadlock, make Go print error and stack traces
            go._pendingEvent = { id: 0 };
            go._resume();
          }
        });
        return go.run(result.instance);
      })
      .catch((err) => {
        core.setFailed(err.message);
      });
  } catch (error) {
    core.setFailed(error.message);
  }
}

export default {
  run,
};
