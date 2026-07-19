const fs = require('fs');
let content = fs.readFileSync('rust/crates/api/src/router.rs', 'utf8');

content = content.replace(
    /String::from_utf8_lossy\(&buf\)\.to_string\(\)/g,
    'String::from_utf8_lossy(&buf)'
);

fs.writeFileSync('rust/crates/api/src/router.rs', content);
