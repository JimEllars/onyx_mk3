const fs = require('fs');
let code = fs.readFileSync('rust/crates/onyx/src/main.rs', 'utf8');

// Also update panic hook just in case it wasn't added properly
const hookCode = `
    let default_panic = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        // Safe terminal reset on panic
        let _ = crossterm::terminal::disable_raw_mode();
        let _ = crossterm::execute!(
            std::io::stdout(),
            crossterm::terminal::LeaveAlternateScreen,
            crossterm::event::DisableMouseCapture
        );
        default_panic(panic_info);
    }));
`;
if (!code.includes('std::panic::take_hook()')) {
  code = code.replace(/pub async fn main\(\)[^\{]*\{/, match => match + '\n' + hookCode);
}
fs.writeFileSync('rust/crates/onyx/src/main.rs', code);
