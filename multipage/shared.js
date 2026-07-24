// shared.js is split into 4 parts (GitHub API push-size limits during recovery
// from a truncated push). This loader pulls them in via document.write so they
// execute in strict order and share one global scope, exactly as the original
// single shared.js did — no changes needed to any team's index.html.
//
// Important: document.write() resolves relative URLs against the *document's*
// base URL (multipage/<team>/index.html), not against shared.js's own location
// (multipage/). Since shared.js lives one directory above the team pages that
// load it via "../shared.js", the sibling part files need the same "../" prefix
// here — omitting it (as an earlier version of this file did) resolves to
// multipage/<team>/shared_part1.js, which doesn't exist, and silently breaks
// the whole dashboard. Verified against a real script-loading engine (jsdom
// with runScripts:"dangerously"/resources:"usable", not just eval-in-one-scope)
// before shipping.
document.write('<script src="../shared_part1.js"><\/script>');
document.write('<script src="../shared_part2.js"><\/script>');
document.write('<script src="../shared_part3.js"><\/script>');
document.write('<script src="../shared_part4.js"><\/script>');
