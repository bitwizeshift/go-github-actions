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
    go.importObject = {
      _gotest: {
        add: (a, b) => a + b,
      },
      gojs: {
        // Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
        // may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
        // function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
        // This changes the SP, thus we have to update the SP used by the imported function.

        // func wasmExit(code int32)
        "runtime.wasmExit": (sp) => {
          sp >>>= 0;
          const code = go.mem.getInt32(sp + 8, true);
          go.exited = true;
          delete go._inst;
          delete go._values;
          delete go._goRefCounts;
          delete go._ids;
          delete go._idPool;
          go.exit(code);
        },

        // func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
        "runtime.wasmWrite": (sp) => {
          sp >>>= 0;
          const fd = getInt64(sp + 8);
          const p = getInt64(sp + 16);
          const n = go.mem.getInt32(sp + 24, true);
          fs.writeSync(fd, new Uint8Array(go._inst.exports.mem.buffer, p, n));
        },

        // func resetMemoryDataView()
        "runtime.resetMemoryDataView": (sp) => {
          sp >>>= 0;
          go.mem = new DataView(go._inst.exports.mem.buffer);
        },

        // func nanotime1() int64
        "runtime.nanotime1": (sp) => {
          sp >>>= 0;
          setInt64(sp + 8, (timeOrigin + performance.now()) * 1000000);
        },

        // func walltime() (sec int64, nsec int32)
        "runtime.walltime": (sp) => {
          sp >>>= 0;
          const msec = new Date().getTime();
          setInt64(sp + 8, msec / 1000);
          go.mem.setInt32(sp + 16, (msec % 1000) * 1000000, true);
        },

        // func scheduleTimeoutEvent(delay int64) int32
        "runtime.scheduleTimeoutEvent": (sp) => {
          sp >>>= 0;
          const id = go._nextCallbackTimeoutID;
          go._nextCallbackTimeoutID++;
          go._scheduledTimeouts.set(
            id,
            setTimeout(() => {
              go._resume();
              while (go._scheduledTimeouts.has(id)) {
                // for some reason Go failed to register the timeout event, log and try again
                // (temporary workaround for https://github.com/golang/go/issues/28975)
                console.warn("scheduleTimeoutEvent: missed timeout event");
                go._resume();
              }
            }, getInt64(sp + 8))
          );
          go.mem.setInt32(sp + 16, id, true);
        },

        // func clearTimeoutEvent(id int32)
        "runtime.clearTimeoutEvent": (sp) => {
          sp >>>= 0;
          const id = go.mem.getInt32(sp + 8, true);
          clearTimeout(go._scheduledTimeouts.get(id));
          go._scheduledTimeouts.delete(id);
        },

        // func getRandomData(r []byte)
        "runtime.getRandomData": (sp) => {
          sp >>>= 0;
          crypto.getRandomValues(loadSlice(sp + 8));
        },

        // func finalizeRef(v ref)
        "syscall/js.finalizeRef": (sp) => {
          sp >>>= 0;
          const id = go.mem.getUint32(sp + 8, true);
          go._goRefCounts[id]--;
          if (go._goRefCounts[id] === 0) {
            const v = go._values[id];
            go._values[id] = null;
            go._ids.delete(v);
            go._idPool.push(id);
          }
        },

        // func stringVal(value string) ref
        "syscall/js.stringVal": (sp) => {
          sp >>>= 0;
          storeValue(sp + 24, loadString(sp + 8));
        },

        // func valueGet(v ref, p string) ref
        "syscall/js.valueGet": (sp) => {
          sp >>>= 0;
          const result = Reflect.get(loadValue(sp + 8), loadString(sp + 16));
          sp = go._inst.exports.getsp() >>> 0; // see comment above
          storeValue(sp + 32, result);
        },

        // func valueSet(v ref, p string, x ref)
        "syscall/js.valueSet": (sp) => {
          sp >>>= 0;
          Reflect.set(
            loadValue(sp + 8),
            loadString(sp + 16),
            loadValue(sp + 32)
          );
        },

        // func valueDelete(v ref, p string)
        "syscall/js.valueDelete": (sp) => {
          sp >>>= 0;
          Reflect.deleteProperty(loadValue(sp + 8), loadString(sp + 16));
        },

        // func valueIndex(v ref, i int) ref
        "syscall/js.valueIndex": (sp) => {
          sp >>>= 0;
          storeValue(
            sp + 24,
            Reflect.get(loadValue(sp + 8), getInt64(sp + 16))
          );
        },

        // valueSetIndex(v ref, i int, x ref)
        "syscall/js.valueSetIndex": (sp) => {
          sp >>>= 0;
          Reflect.set(loadValue(sp + 8), getInt64(sp + 16), loadValue(sp + 24));
        },

        // func valueCall(v ref, m string, args []ref) (ref, bool)
        "syscall/js.valueCall": (sp) => {
          sp >>>= 0;
          try {
            const v = loadValue(sp + 8);
            const m = Reflect.get(v, loadString(sp + 16));
            const args = loadSliceOfValues(sp + 32);
            const result = Reflect.apply(m, v, args);
            sp = go._inst.exports.getsp() >>> 0; // see comment above
            storeValue(sp + 56, result);
            go.mem.setUint8(sp + 64, 1);
          } catch (err) {
            sp = go._inst.exports.getsp() >>> 0; // see comment above
            storeValue(sp + 56, err);
            go.mem.setUint8(sp + 64, 0);
          }
        },

        // func valueInvoke(v ref, args []ref) (ref, bool)
        "syscall/js.valueInvoke": (sp) => {
          sp >>>= 0;
          try {
            const v = loadValue(sp + 8);
            const args = loadSliceOfValues(sp + 16);
            const result = Reflect.apply(v, undefined, args);
            sp = go._inst.exports.getsp() >>> 0; // see comment above
            storeValue(sp + 40, result);
            go.mem.setUint8(sp + 48, 1);
          } catch (err) {
            sp = go._inst.exports.getsp() >>> 0; // see comment above
            storeValue(sp + 40, err);
            go.mem.setUint8(sp + 48, 0);
          }
        },

        // func valueNew(v ref, args []ref) (ref, bool)
        "syscall/js.valueNew": (sp) => {
          sp >>>= 0;
          try {
            const v = loadValue(sp + 8);
            const args = loadSliceOfValues(sp + 16);
            const result = Reflect.construct(v, args);
            sp = go._inst.exports.getsp() >>> 0; // see comment above
            storeValue(sp + 40, result);
            go.mem.setUint8(sp + 48, 1);
          } catch (err) {
            sp = go._inst.exports.getsp() >>> 0; // see comment above
            storeValue(sp + 40, err);
            go.mem.setUint8(sp + 48, 0);
          }
        },

        // func valueLength(v ref) int
        "syscall/js.valueLength": (sp) => {
          sp >>>= 0;
          setInt64(sp + 16, parseInt(loadValue(sp + 8).length));
        },

        // valuePrepareString(v ref) (ref, int)
        "syscall/js.valuePrepareString": (sp) => {
          sp >>>= 0;
          const str = encoder.encode(String(loadValue(sp + 8)));
          storeValue(sp + 16, str);
          setInt64(sp + 24, str.length);
        },

        // valueLoadString(v ref, b []byte)
        "syscall/js.valueLoadString": (sp) => {
          sp >>>= 0;
          const str = loadValue(sp + 8);
          loadSlice(sp + 16).set(str);
        },

        // func valueInstanceOf(v ref, t ref) bool
        "syscall/js.valueInstanceOf": (sp) => {
          sp >>>= 0;
          go.mem.setUint8(
            sp + 24,
            loadValue(sp + 8) instanceof loadValue(sp + 16) ? 1 : 0
          );
        },

        // func copyBytesToGo(dst []byte, src ref) (int, bool)
        "syscall/js.copyBytesToGo": (sp) => {
          sp >>>= 0;
          const dst = loadSlice(sp + 8);
          const src = loadValue(sp + 32);
          if (
            !(src instanceof Uint8Array || src instanceof Uint8ClampedArray)
          ) {
            go.mem.setUint8(sp + 48, 0);
            return;
          }
          const toCopy = src.subarray(0, dst.length);
          dst.set(toCopy);
          setInt64(sp + 40, toCopy.length);
          go.mem.setUint8(sp + 48, 1);
        },

        // func copyBytesToJS(dst ref, src []byte) (int, bool)
        "syscall/js.copyBytesToJS": (sp) => {
          sp >>>= 0;
          const dst = loadValue(sp + 8);
          const src = loadSlice(sp + 16);
          if (
            !(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)
          ) {
            go.mem.setUint8(sp + 48, 0);
            return;
          }
          const toCopy = src.subarray(0, dst.length);
          dst.set(toCopy);
          setInt64(sp + 40, toCopy.length);
          go.mem.setUint8(sp + 48, 1);
        },

        debug: (value) => {
          console.log(value);
        },
      },
    };
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
