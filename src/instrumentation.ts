// Runs once when a server instance starts. A missing or invalid secret stops the server here,
// with a clear message, instead of failing later in the middle of a request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("./env");
    env();
  }
}
