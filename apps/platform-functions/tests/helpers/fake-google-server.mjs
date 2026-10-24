/**
 * The deployer's fake Google (and fake GitHub and the cafe's own address) as
 * an HTTP server, for the function under the Functions emulator, which runs
 * in another process. src/runtime.mjs sends it every request with the
 * address it was meant for in `x-cafemenu-url`.
 */
import { createServer } from "node:http";

import {
  createFakeGoogle,
  freshState,
} from "../../../../packages/deployer/tests/helpers/fake-google.mjs";

const JSON_OR_FORM = /json|x-www-form-urlencoded/;

export async function startFakeGoogle({
  port = 8399,
  state = freshState(),
} = {}) {
  const google = createFakeGoogle({ state });
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const type = req.headers["content-type"] ?? "";
      let body;
      if (buffer.length)
        body = JSON_OR_FORM.test(type) ? buffer.toString() : buffer;
      const response = await google.fetchImpl(req.headers["x-cafemenu-url"], {
        method: req.method,
        headers: req.headers,
        body,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500).end(String(error.stack ?? error));
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    google,
    state,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
