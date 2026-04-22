with open("rust/crates/runtime/src/memory.rs", "r") as f:
    text = f.read()

# Make it safe for non-tokio contexts by checking if handle exists
text = text.replace("""    tokio::task::spawn(async move {""", """    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(async move {""")
text = text.replace("""        }
    });
}""", """        });
    } else {
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {""")
# The above approach is a bit messy, let's just use thread::spawn + rt.block_on unconditionally.
