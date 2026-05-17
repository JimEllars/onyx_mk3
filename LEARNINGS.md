Record Learnings:
- Use `uuid` and explicit `Drop` guard for temp file lifecycle management instead of process id `std::process::id()` to avoid race conditions in multi-threaded asynchronous contexts.
- Use `tokio::task::block_in_place(|| { tokio::runtime::Handle::current().block_on(...) })` wrapper pattern to await async tasks when creating custom tools exposed globally through a sync boundary (`GlobalToolRegistry`), preventing "Cannot start a runtime from within a runtime" errors inside headless daemon deployment mode.
