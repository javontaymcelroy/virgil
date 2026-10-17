/* Converse mode — a later phase; nothing imports this yet.

   Ask about what you're reading; the reply is plain prose that goes straight onto the reader
   (and through the voice pipeline when voice is on). Providers share one shape:

     anthropic  bring-your-own API key, kept in the macOS Keychain and used only from Rust
     ollama     a local model at http://localhost:11434, for people who want everything on-device

   The system prompt asks for running prose (no Markdown, lists or headings) because the reply
   is read one word at a time. */

/**
 * @typedef {{role: "user"|"assistant", content: string}} Turn
 * @typedef {object} ConverseProvider
 * @property {"anthropic"|"ollama"} id
 * @property {() => Promise<boolean>} ready
 * @property {(system: string, turns: Turn[], onText: (soFar: string) => void, signal: AbortSignal) => Promise<string>} reply
 */

export {};
