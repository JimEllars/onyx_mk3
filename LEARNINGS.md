# Learnings

- When modifying Rust asynchronous contexts, always manage lifetimes carefully, especially when dropping lock guards (`MutexGuard`) to prevent holding locks across `await` points which causes compilation errors.
- Do not use string replacements or Python scripts to edit Rust files—use raw CLI or manual edits to maintain precision.
- The `MicroProgram` architecture is used for routing internal AXiM tools. Each tool exposes a specific string via the `signature()` method which gets hit when routing payloads to it.
