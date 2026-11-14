---
'@agentix-e/micro-kinetic-storage-fs': minor
'@agentix-e/micro-kinetic-optimize': minor
---

`FileSystemStore` resolves its base directory once per construction and honours the
`MICRO_KINETIC_STORE_DIR` environment variable, so the default store can be relocated instead of
being frozen at `~/.micro-kinetic/store` when the module is first imported. A failed atomic write
no longer leaves its temp file behind, `keys()` no longer reports a directory as a key, and the
unreachable parent-directory step in `set` is gone.

`saveModel` and `loadModel` accept an optional `IKeyValueStore`. The default is unchanged. See
`docs/coverage-gate-audit.md` for what the missing parameter cost: the only test that reached these
functions wrote to, and then deleted from, the developer's real store.
