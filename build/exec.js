var argv = require('yargs').argv;
if (argv.script) {
    if (argv.entry) {
        require(argv.script)[argv.entry](argv);
    } else {
        require(argv.script);
    }

    process.stdin.resume();
}
