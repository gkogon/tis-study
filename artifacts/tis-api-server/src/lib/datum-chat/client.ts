/**
 * The Datum chat's model client: the one module that touches @anthropic-ai/sdk.
 *
 * No key, no chat. `getDatumClient()` answers null while ANTHROPIC_API_KEY is
 * unset, and then nothing loads the SDK: the import below is a dynamic
 * `import()` inside a function, run the first time a client is asked for with
 * the key set, and the client it builds is kept for the life of the process.
 * The only static import of the SDK here is `import type`, which tsc, esbuild
 * and node's type stripping all erase. verify-datum-chat.mjs pins both facts,
 * and with the key unset it watches the SDK's name never being resolved.
 *
 * `adaptAnthropic` is the typed bridge from the SDK's client to run.ts's local
 * `DatumClient`, which the loop codes against so that it never imports the SDK.
 * The two differ in three places, and only there:
 *   - Params. run.ts hands `stream()` an `object` it built itself; the SDK
 *     wants `MessageStreamParams`. That is the one assertion in this file. The
 *     two parts of those params that are fixed shapes (the tools and the system
 *     blocks) are checked against the SDK's own types at compile time below.
 *   - Content blocks. The SDK declares its blocks as interfaces, and an
 *     interface carries no index signature, so TypeScript will not assign one to
 *     run.ts's `{ type: string; [k: string]: unknown }`. `asModelBlock` widens
 *     through a type literal, which may take one, and returns the same object:
 *     the loop sends each block back to the API exactly as it came, thinking
 *     blocks and their signatures included.
 *   - `stop_reason` is `StopReason | null` in the SDK's Message (null only on a
 *     message still being streamed); the loop stores a string.
 * The text listener is also narrowed: the SDK passes the delta and the text so
 * far, and the loop takes the delta alone.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { DatumClient, ModelBlock, ModelMessage, ModelStream } from "./run.ts";
import type { DatumTool } from "./tools.ts";
import type { SystemBlock } from "./prompt.ts";

// Compile-time only: the tool and system shapes run.ts sends are ones the SDK accepts as they are.
type Holds<T extends true> = T;
export type DatumToolsFitTheSdk = Holds<DatumTool extends Anthropic.Tool ? true : false>;
export type DatumSystemFitsTheSdk = Holds<SystemBlock extends Anthropic.TextBlockParam ? true : false>;

/** The part of the SDK's MessageStream the adapter reads. */
type SdkStream = {
  on(event: "text", listener: (delta: string, snapshot: string) => void): unknown;
  abort(): void;
  finalMessage(): Promise<Anthropic.Message>;
};

/** The part of the SDK's client the adapter reads. `new Anthropic()` is one. */
export type SdkClient = { messages: { stream(body: Anthropic.MessageStreamParams): SdkStream } };

/** What `stop_reason` is stored as when the SDK has none to give. */
const NO_STOP_REASON = "unknown";

/** An SDK content block as run.ts's ModelBlock: the same object, widened. See the header. */
function asModelBlock(block: Anthropic.ContentBlock): ModelBlock {
  const widened: { type: string } = block;
  return widened;
}

function toModelMessage(message: Anthropic.Message): ModelMessage {
  return {
    content: message.content.map(asModelBlock),
    stop_reason: message.stop_reason ?? NO_STOP_REASON,
    model: message.model,
    usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
  };
}

/** The SDK's client as the loop's DatumClient. */
export function adaptAnthropic(client: SdkClient): DatumClient {
  return {
    messages: {
      stream(params: object): ModelStream {
        // run.ts builds these params (its callParams); see the header for why this is the one assertion.
        const stream = client.messages.stream(params as Anthropic.MessageStreamParams);
        return {
          on(_event: "text", cb: (delta: string) => void): unknown {
            return stream.on("text", (delta) => cb(delta));
          },
          abort(): void {
            stream.abort();
          },
          async finalMessage(): Promise<ModelMessage> {
            return toModelMessage(await stream.finalMessage());
          },
        };
      },
    },
  };
}

/** The SDK module, as far as this file uses it: its default export, the client class. */
export type SdkModule = { default: new () => SdkClient };

/**
 * A getter that answers null while `hasKey()` is false, and otherwise loads the
 * SDK once and keeps the one client it builds. Concurrent first calls share the
 * load. A load that fails rejects the calls waiting on it and is tried again on
 * the next one, so a passing failure does not turn the chat off until a restart.
 * Exported so the check can drive it with a fake SDK and a fake key switch.
 */
export function makeDatumClientGetter(source: { hasKey: () => boolean; load: () => Promise<SdkModule> }): () => Promise<DatumClient | null> {
  let made: Promise<DatumClient> | null = null;
  return async () => {
    if (!source.hasKey()) return null;
    if (made === null) {
      const loading = source.load().then((sdk) => adaptAnthropic(new sdk.default()));
      made = loading;
      loading.catch(() => {
        if (made === loading) made = null;
      });
    }
    return made;
  };
}

/** Whether the chat is on: a model key is set. The routes answer { enabled: false } otherwise. */
export function datumChatEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** The process's model client, or null with no key. `new Anthropic()` reads ANTHROPIC_API_KEY itself. */
export const getDatumClient: () => Promise<DatumClient | null> = makeDatumClientGetter({
  hasKey: datumChatEnabled,
  load: () => import("@anthropic-ai/sdk"),
});
