/**
 * Request deduplication for GitHub API calls.
 *
 * Shares concurrent identical requests to avoid duplicate gh CLI calls.
 */

/**
 * Deduplicates concurrent requests with the same key.
 * When multiple callers request the same data simultaneously,
 * only one gh CLI call is made and all callers receive the same promise.
 */
export class RequestDeduplicator {
  private pendingRequests = new Map<string, Promise<unknown>>();

  /**
   * Execute a function, deduplicating concurrent calls with the same key.
   * @param key Unique identifier for this request
   * @param fn Async function to execute
   * @returns Promise that resolves to the function's result
   */
  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = fn().finally(() => this.pendingRequests.delete(key));
    this.pendingRequests.set(key, promise);
    return promise;
  }
}

/**
 * Global deduplicator instance for GitHub API calls.
 */
export const ghDeduplicator = new RequestDeduplicator();
