import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { TestContext } from "node:test";
import type { RequestOptions } from "node:https";
import type { IncomingMessage } from "node:http";

export function mockImageRequests(
  context: TestContext,
  respond: (url: URL, options: RequestOptions) => {
    status?: number;
    headers?: Record<string, string>;
    body?: string | Buffer;
  }
): void {
  context.mock.method(https, "request", (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const result = respond(url, options);
    const response = Object.assign(new PassThrough(), {
      statusCode: result.status ?? 200,
      headers: result.headers ?? {}
    });
    const request = Object.assign(new EventEmitter(), {
      end() {
        queueMicrotask(() => {
          callback(response as unknown as IncomingMessage);
          if (result.body !== undefined) response.end(result.body);
        });
      }
    });
    const onAbort = () => {
      const error = new DOMException("Aborted", "AbortError");
      response.destroy(error);
      request.emit("error", error);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    response.once("close", () => options.signal?.removeEventListener("abort", onAbort));
    return request;
  });
}
