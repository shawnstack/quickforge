import type { StorageBackend, StoreConfig } from './types'

/**
 * Base class for all storage stores.
 * Each store defines its store schema and provides domain-specific methods.
 */
export abstract class Store {
  private backend: StorageBackend | null = null

  /**
   * Returns the store configuration (name, key path, indices).
   * Backends use it to provision the underlying object stores.
   */
  abstract getConfig(): StoreConfig

  /**
   * Sets the storage backend. Called by AppStorage after backend creation.
   */
  setBackend(backend: StorageBackend): void {
    this.backend = backend
  }

  /**
   * Gets the storage backend. Throws if backend not set.
   */
  protected getBackend(): StorageBackend {
    if (!this.backend) {
      throw new Error(`Backend not set on ${this.constructor.name}`)
    }
    return this.backend
  }
}
