import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export async function requireFreePort(port, label) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(
        new Error(
          `${label}: port ${port} is occupied or unavailable (already in use); stop its owner or change the local port. No existing process was killed.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

/** Own only the processes spawned by this invocation, including their descendants. */
export class WorkspaceProcesses {
  children = [];
  controller = new AbortController();
  stopping = false;
  failure = null;

  start(program, args, options = {}) {
    if (this.stopping) throw new Error("Workspace startup was cancelled");
    const child = spawn(program, args, {
      stdio: "inherit",
      detached: process.platform !== "win32",
      ...options,
    });
    const record = { child, closed: false };
    record.done = new Promise((resolve) => {
      child.once("error", (error) => {
        this.failure ||= error;
        this.controller.abort();
        resolve();
      });
      child.once("close", (code, signal) => {
        record.closed = true;
        if (!this.stopping) {
          if (code !== 0 || signal)
            this.failure ||= new Error(
              `${program} exited (${signal || code}); closing this frontend group`,
            );
          this.controller.abort();
        }
        resolve();
      });
    });
    this.children.push(record);
    return child;
  }

  async ready(url, timeout = 60000) {
    const deadline = Date.now() + timeout;
    while (!this.controller.signal.aborted && Date.now() < deadline) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([
            this.controller.signal,
            AbortSignal.timeout(1500),
          ]),
        });
        if (response.ok) return;
      } catch {
        /* The owned dev server may still be compiling. */
      }
      try {
        await delay(200, undefined, { signal: this.controller.signal });
      } catch {
        break;
      }
    }
    throw this.failure || new Error(`Frontend did not become ready: ${url}`);
  }

  async wait() {
    if (!this.controller.signal.aborted)
      await new Promise((resolve) =>
        this.controller.signal.addEventListener("abort", resolve, {
          once: true,
        }),
      );
    await this.stop();
    if (this.failure) throw this.failure;
  }

  stop() {
    if (this.cleanup) return this.cleanup;
    this.stopping = true;
    this.controller.abort();
    this.cleanup = (async () => {
      const signal = (record, value) => {
        if (!record.child.pid) return;
        try {
          if (process.platform === "win32") {
            // taskkill targets this owned PID tree, never a name-wide process match.
            spawn("taskkill", ["/PID", String(record.child.pid), "/T", "/F"], {
              stdio: "ignore",
            });
          } else process.kill(-record.child.pid, value);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      };
      for (const record of this.children) signal(record, "SIGTERM");
      let timer;
      const settled = Promise.all(this.children.map((record) => record.done));
      await Promise.race([
        settled,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 4000);
        }),
      ]);
      clearTimeout(timer);
      for (const record of this.children) signal(record, "SIGKILL");
      await settled;
    })();
    return this.cleanup;
  }
}
