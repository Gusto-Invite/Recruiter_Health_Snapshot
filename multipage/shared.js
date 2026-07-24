// shared.js is split into 4 parts (GitHub API push-size limits during recovery
// from a truncated push). This loader pulls them in via document.write so they
// execute in strict order and share one global scope, exactly as the original
// single shared.js did — no changes needed to any team's index.html.
document.write('<script src="shared_part1.js"><\/script>');
document.write('<script src="shared_part2.js"><\/script>');
document.write('<script src="shared_part3.js"><\/script>');
document.write('<script src="shared_part4.js"><\/script>');
